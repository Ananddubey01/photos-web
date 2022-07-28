import { getLocalFiles, setLocalFiles } from '../fileService';
import { SetFiles } from 'types/gallery';
import { getDedicatedCryptoWorker } from 'utils/crypto';
import {
    sortFilesIntoCollections,
    sortFiles,
    preservePhotoswipeProps,
    decryptFile,
} from 'utils/file';
import { logError } from 'utils/sentry';
import { getMetadataJSONMapKey, parseMetadataJSON } from './metadataService';
import {
    areFileWithCollectionsSame,
    segregateMetadataAndMediaFiles,
} from 'utils/upload';
import uploader from './uploader';
import UIService from './uiService';
import UploadService from './uploadService';
import { CustomError } from 'utils/error';
import { Collection } from 'types/collection';
import { EnteFile } from 'types/file';
import {
    ElectronFile,
    FileWithCollection,
    Metadata,
    MetadataAndFileTypeInfo,
    MetadataAndFileTypeInfoMap,
    ParsedMetadataJSON,
    ParsedMetadataJSONMap,
} from 'types/upload';
import {
    UPLOAD_RESULT,
    MAX_FILE_SIZE_SUPPORTED,
    UPLOAD_STAGES,
} from 'constants/upload';
import { ComlinkWorker } from 'utils/comlink';
import { FILE_TYPE } from 'constants/file';
import uiService from './uiService';
import { addLogLine, getFileNameSize } from 'utils/logging';
import isElectron from 'is-electron';
import ImportService from 'services/importService';
import { ProgressUpdater } from 'types/upload/ui';
import transcodingService from 'services/transcodingService';
import uploadService from './uploadService';

const MAX_CONCURRENT_UPLOADS = 4;
const FILE_UPLOAD_COMPLETED = 100;

class UploadManager {
    private cryptoWorkers = new Array<ComlinkWorker>(MAX_CONCURRENT_UPLOADS);
    private parsedMetadataJSONMap: ParsedMetadataJSONMap;
    private metadataAndFileTypeInfoMap: MetadataAndFileTypeInfoMap;
    private filesToBeUploaded: FileWithCollection[];
    private remainingFiles: FileWithCollection[] = [];
    private failedFiles: FileWithCollection[];
    private existingFilesCollectionWise: Map<number, EnteFile[]>;
    private existingFiles: EnteFile[];
    private setFiles: SetFiles;
    private collections: Map<number, Collection>;
    public initUploader(progressUpdater: ProgressUpdater, setFiles: SetFiles) {
        UIService.init(progressUpdater);
        this.setFiles = setFiles;
    }

    private resetState() {
        this.filesToBeUploaded = [];
        this.remainingFiles = [];
        this.failedFiles = [];
        this.parsedMetadataJSONMap = new Map<string, ParsedMetadataJSON>();
        this.metadataAndFileTypeInfoMap = new Map<
            number,
            MetadataAndFileTypeInfo
        >();
    }

    private async init(collections: Collection[]) {
        this.resetState();
        this.existingFiles = await getLocalFiles();
        this.existingFilesCollectionWise = sortFilesIntoCollections(
            this.existingFiles
        );
        this.collections = new Map(
            collections.map((collection) => [collection.id, collection])
        );
    }

    public async queueFilesForUpload(
        fileWithCollectionToBeUploaded: FileWithCollection[],
        collections: Collection[]
    ) {
        try {
            await this.init(collections);
            addLogLine(
                `received ${fileWithCollectionToBeUploaded.length} files to upload`
            );
            const { metadataJSONFiles, mediaFiles } =
                segregateMetadataAndMediaFiles(fileWithCollectionToBeUploaded);
            addLogLine(`has ${metadataJSONFiles.length} metadata json files`);
            addLogLine(`has ${mediaFiles.length} media files`);
            if (metadataJSONFiles.length) {
                UIService.setUploadStage(
                    UPLOAD_STAGES.READING_GOOGLE_METADATA_FILES
                );
                await this.parseMetadataJSONFiles(metadataJSONFiles);
                UploadService.setParsedMetadataJSONMap(
                    this.parsedMetadataJSONMap
                );
            }
            if (mediaFiles.length) {
                UIService.setUploadStage(UPLOAD_STAGES.EXTRACTING_METADATA);
                await this.extractMetadataFromFiles(mediaFiles);
                UploadService.setMetadataAndFileTypeInfoMap(
                    this.metadataAndFileTypeInfoMap
                );

                UIService.setUploadStage(UPLOAD_STAGES.START);
                addLogLine(`clusterLivePhotoFiles called`);

                // filter out files whose metadata detection failed or those that have been skipped because the files are too large,
                // as they will be rejected during upload and are not valid upload files which we need to clustering
                const rejectedFileLocalIDs = new Set(
                    [...this.metadataAndFileTypeInfoMap.entries()].map(
                        ([localID, metadataAndFileTypeInfo]) => {
                            if (
                                !metadataAndFileTypeInfo.metadata ||
                                !metadataAndFileTypeInfo.fileTypeInfo
                            ) {
                                return localID;
                            }
                        }
                    )
                );
                const rejectedFiles = [];
                const filesWithMetadata: FileWithCollection[] = [];
                mediaFiles.forEach((m) => {
                    if (rejectedFileLocalIDs.has(m.localID)) {
                        rejectedFiles.push(m);
                    } else {
                        filesWithMetadata.push(m);
                    }
                });

                const analysedMediaFiles =
                    UploadService.clusterLivePhotoFiles(filesWithMetadata);

                const allFiles = [...rejectedFiles, ...analysedMediaFiles];

                uiService.setFilenames(
                    new Map<number, string>(
                        allFiles.map((mediaFile) => [
                            mediaFile.localID,
                            UploadService.getAssetName(mediaFile),
                        ])
                    )
                );

                UIService.setHasLivePhoto(
                    mediaFiles.length !== allFiles.length
                );
                addLogLine(
                    `got live photos: ${mediaFiles.length !== allFiles.length}`
                );

                await this.uploadMediaFiles(allFiles);
            }
            UIService.setUploadStage(UPLOAD_STAGES.FINISH);
            UIService.setPercentComplete(FILE_UPLOAD_COMPLETED);
        } catch (e) {
            logError(e, 'uploading failed with error');
            addLogLine(
                `uploading failed with error -> ${e.message}
                ${(e as Error).stack}`
            );
            throw e;
        } finally {
            for (let i = 0; i < MAX_CONCURRENT_UPLOADS; i++) {
                this.cryptoWorkers[i]?.worker.terminate();
            }
        }
    }

    private async parseMetadataJSONFiles(metadataFiles: FileWithCollection[]) {
        try {
            addLogLine(`parseMetadataJSONFiles function executed `);

            UIService.reset(metadataFiles.length);

            for (const { file, collectionID } of metadataFiles) {
                try {
                    addLogLine(
                        `parsing metadata json file ${getFileNameSize(file)}`
                    );

                    const parsedMetadataJSONWithTitle = await parseMetadataJSON(
                        file
                    );
                    if (parsedMetadataJSONWithTitle) {
                        const { title, parsedMetadataJSON } =
                            parsedMetadataJSONWithTitle;
                        this.parsedMetadataJSONMap.set(
                            getMetadataJSONMapKey(collectionID, title),
                            parsedMetadataJSON && { ...parsedMetadataJSON }
                        );
                        UIService.increaseFileUploaded();
                    }
                    addLogLine(
                        `successfully parsed metadata json file ${getFileNameSize(
                            file
                        )}`
                    );
                } catch (e) {
                    logError(e, 'parsing failed for a file');
                    addLogLine(
                        `failed to parse metadata json file ${getFileNameSize(
                            file
                        )} error: ${e.message}`
                    );
                }
            }
        } catch (e) {
            logError(e, 'error seeding MetadataMap');
            // silently ignore the error
        }
    }

    private async extractMetadataFromFiles(mediaFiles: FileWithCollection[]) {
        try {
            addLogLine(`extractMetadataFromFiles executed`);
            UIService.reset(mediaFiles.length);
            for (const { file, localID, collectionID } of mediaFiles) {
                let fileTypeInfo = null;
                let metadata: Metadata = null;
                try {
                    addLogLine(
                        `metadata extraction started ${getFileNameSize(file)} `
                    );
                    const result = await this.extractFileTypeAndMetadata(
                        file,
                        collectionID
                    );
                    fileTypeInfo = result.fileTypeInfo;
                    metadata = result.metadata;
                    addLogLine(
                        `metadata extraction successful${getFileNameSize(
                            file
                        )} `
                    );
                } catch (e) {
                    logError(e, 'extractFileTypeAndMetadata failed');
                    addLogLine(
                        `metadata extraction failed ${getFileNameSize(
                            file
                        )} error: ${e.message}`
                    );
                }
                if (metadata) {
                    const fileVariants = await transcodingService.transcodeFile(
                        file,
                        metadata
                    );
                    uploadService.setFileVariants(localID, fileVariants);
                }
                this.metadataAndFileTypeInfoMap.set(localID, {
                    fileTypeInfo: fileTypeInfo && { ...fileTypeInfo },
                    metadata: metadata && { ...metadata },
                });
                UIService.increaseFileUploaded();
            }
        } catch (e) {
            logError(e, 'error extracting metadata');
            throw e;
        }
    }

    private async extractFileTypeAndMetadata(
        file: File | ElectronFile,
        collectionID: number
    ) {
        if (file.size >= MAX_FILE_SIZE_SUPPORTED) {
            addLogLine(
                `${getFileNameSize(file)} rejected  because of large size`
            );

            return { fileTypeInfo: null, metadata: null };
        }
        const fileTypeInfo = await UploadService.getFileType(file);
        if (fileTypeInfo.fileType === FILE_TYPE.OTHERS) {
            addLogLine(
                `${getFileNameSize(
                    file
                )} rejected  because of unknown file format`
            );
            return { fileTypeInfo, metadata: null };
        }
        addLogLine(` extracting ${getFileNameSize(file)} metadata`);
        let metadata: Metadata;
        try {
            metadata = await UploadService.extractFileMetadata(
                file,
                collectionID,
                fileTypeInfo
            );
        } catch (e) {
            logError(e, 'failed to extract file metadata');
            return { fileTypeInfo, metadata: null };
        }
        return { fileTypeInfo, metadata };
    }

    private async uploadMediaFiles(mediaFiles: FileWithCollection[]) {
        addLogLine(`uploadMediaFiles called`);
        this.filesToBeUploaded.push(...mediaFiles);

        if (isElectron()) {
            this.remainingFiles.push(...mediaFiles);
        }

        UIService.reset(mediaFiles.length);

        await UploadService.setFileCount(mediaFiles.length);

        UIService.setUploadStage(UPLOAD_STAGES.UPLOADING);

        const uploadProcesses = [];
        for (
            let i = 0;
            i < MAX_CONCURRENT_UPLOADS && this.filesToBeUploaded.length > 0;
            i++
        ) {
            const cryptoWorker = getDedicatedCryptoWorker();
            if (!cryptoWorker) {
                throw Error(CustomError.FAILED_TO_LOAD_WEB_WORKER);
            }
            this.cryptoWorkers[i] = cryptoWorker;
            uploadProcesses.push(
                this.uploadNextFileInQueue(
                    await new this.cryptoWorkers[i].comlink()
                )
            );
        }
        await Promise.all(uploadProcesses);
    }

    private async uploadNextFileInQueue(worker: any) {
        while (this.filesToBeUploaded.length > 0) {
            let fileWithCollection = this.filesToBeUploaded.pop();
            const { collectionID } = fileWithCollection;
            const existingFilesInCollection =
                this.existingFilesCollectionWise.get(collectionID) ?? [];
            const collection = this.collections.get(collectionID);
            fileWithCollection = { ...fileWithCollection, collection };
            const { fileUploadResult, uploadedFile, skipDecryption } =
                await uploader(
                    worker,
                    existingFilesInCollection,
                    this.existingFiles,
                    fileWithCollection
                );
            const finalUploadResult = await this.postUploadTask(
                fileUploadResult,
                uploadedFile,
                skipDecryption,
                fileWithCollection
            );
            UIService.moveFileToResultList(
                fileWithCollection.localID,
                finalUploadResult
            );
            UploadService.reducePendingUploadCount();
        }
    }

    async postUploadTask(
        fileUploadResult: UPLOAD_RESULT,
        uploadedFile: EnteFile,
        skipDecryption: boolean,
        fileWithCollection: FileWithCollection
    ) {
        try {
            addLogLine(`uploadedFile ${JSON.stringify(uploadedFile)}`);

            if (
                (fileUploadResult === UPLOAD_RESULT.UPLOADED ||
                    fileUploadResult ===
                        UPLOAD_RESULT.UPLOADED_WITH_STATIC_THUMBNAIL) &&
                !skipDecryption
            ) {
                const decryptedFile = await decryptFile(
                    uploadedFile,
                    fileWithCollection.collection.key
                );
                this.existingFiles.push(decryptedFile);
                this.existingFiles = sortFiles(this.existingFiles);
                await setLocalFiles(this.existingFiles);
                this.setFiles(preservePhotoswipeProps(this.existingFiles));
                if (
                    !this.existingFilesCollectionWise.has(
                        decryptedFile.collectionID
                    )
                ) {
                    this.existingFilesCollectionWise.set(
                        decryptedFile.collectionID,
                        []
                    );
                }
                this.existingFilesCollectionWise
                    .get(decryptedFile.collectionID)
                    .push(decryptedFile);
            }
            if (
                fileUploadResult === UPLOAD_RESULT.FAILED ||
                fileUploadResult === UPLOAD_RESULT.BLOCKED
            ) {
                this.failedFiles.push(fileWithCollection);
            }

            if (isElectron()) {
                this.remainingFiles = this.remainingFiles.filter(
                    (file) =>
                        !areFileWithCollectionsSame(file, fileWithCollection)
                );
                ImportService.updatePendingUploads(this.remainingFiles);
            }
            return fileUploadResult;
        } catch (e) {
            logError(e, 'failed to do post file upload action');
            addLogLine(
                `failed to do post file upload action -> ${e.message}
                ${(e as Error).stack}`
            );
            return UPLOAD_RESULT.FAILED;
        }
    }

    async retryFailedFiles() {
        await this.queueFilesForUpload(this.failedFiles, [
            ...this.collections.values(),
        ]);
    }
}

export default new UploadManager();
