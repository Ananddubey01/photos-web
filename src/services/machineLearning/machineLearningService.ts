import { File, FILE_TYPE, getLocalFiles } from 'services/fileService';

import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-wasm';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import '@tensorflow/tfjs-backend-cpu';

import {
    Face,
    MlFileData,
    MLLibraryData,
    MLSyncConfig,
    MLSyncContext,
    MLSyncFileContext,
    MLSyncResult,
    Person,
} from 'types/machineLearning';

import { toTSNE } from 'utils/machineLearning/visualization';
import {
    getIndexVersion,
    incrementIndexVersion,
    mlFilesStore,
    mlPeopleStore,
    mlLibraryStore,
    newMlData,
    setIndexVersion,
    getAllFacesMap,
} from 'utils/storage/mlStorage';
import {
    findFirstIfSorted,
    getAllFacesFromMap,
    getFaceImage,
    getLocalFileImageBitmap,
    getMLSyncConfig,
    getOriginalImageBitmap,
    getThumbnailImageBitmap,
    isDifferentOrOld,
} from 'utils/machineLearning';
import { MLFactory } from './machineLearningFactory';

class MachineLearningService {
    private initialized = false;
    // private faceDetectionService: FaceDetectionService;
    // private faceLandmarkService: FAPIFaceLandmarksService;
    // private faceAlignmentService: FaceAlignmentService;
    // private faceEmbeddingService: FaceEmbeddingService;
    // private faceEmbeddingService: FAPIFaceEmbeddingService;
    // private clusteringService: ClusteringService;

    public constructor() {
        setWasmPaths('/js/tfjs/');
        // this.faceDetectionService = new TFJSFaceDetectionService();
        // this.faceLandmarkService = new FAPIFaceLandmarksService();
        // this.faceAlignmentService = new ArcfaceAlignmentService();
        // this.faceEmbeddingService = new TFJSFaceEmbeddingService();
        // this.faceEmbeddingService = new FAPIFaceEmbeddingService();
        // this.clusteringService = new ClusteringService();
    }

    public async sync(token: string): Promise<MLSyncResult> {
        if (!token) {
            throw Error('Token needed by ml service to sync file');
        }

        // await this.init();

        // Used to debug tf memory leak, all tf memory
        // needs to be cleaned using tf.dispose or tf.tidy
        // tf.engine().startScope();

        const mlSyncConfig = await getMLSyncConfig();
        const syncContext = MLFactory.getMLSyncContext(
            token,
            mlSyncConfig,
            true
        );

        await this.syncRemovedFiles(syncContext);

        await this.getOutOfSyncFiles(syncContext);

        if (syncContext.outOfSyncFiles.length > 0) {
            await this.syncFiles(syncContext);
        } else {
            await this.syncIndex(syncContext);
        }

        // tf.engine().endScope();

        if (syncContext.config.tsne) {
            await this.runTSNE(syncContext);
        }

        const mlSyncResult: MLSyncResult = {
            nOutOfSyncFiles: syncContext.outOfSyncFiles.length,
            nSyncedFiles: syncContext.syncedFiles.length,
            nSyncedFaces: syncContext.syncedFaces.length,
            nFaceClusters:
                syncContext.mlLibraryData?.faceClusteringResults?.clusters
                    .length,
            nFaceNoise:
                syncContext.mlLibraryData?.faceClusteringResults?.noise.length,
            tsne: syncContext.tsne,
        };
        // console.log('[MLService] sync results: ', mlSyncResult);

        await syncContext.dispose();
        console.log('Final TF Memory stats: ', tf.memory());

        return mlSyncResult;
    }

    private async getMLFileVersion(file: File) {
        const mlFileData: MlFileData = await mlFilesStore.getItem(
            file.id.toString()
        );
        return mlFileData && mlFileData.mlVersion;
    }

    private async getLocalFiles(syncContext: MLSyncContext) {
        if (!syncContext.localFiles) {
            syncContext.localFiles = getLocalFiles();
        }

        return syncContext.localFiles;
    }

    // TODO: not required if ml data is stored as field inside ente file object
    // it removes ml data for files in trash, they will be resynced if restored
    private async syncRemovedFiles(syncContext: MLSyncContext) {
        const localFiles = await this.getLocalFiles(syncContext);
        const localFileIdMap = new Map<number, boolean>();
        localFiles.forEach((f) => localFileIdMap.set(f.id, true));

        const removedFileIds: Array<string> = [];
        await mlFilesStore.iterate((file, idStr) => {
            if (!localFileIdMap.has(parseInt(idStr))) {
                removedFileIds.push(idStr);
            }
        });

        if (removedFileIds.length < 1) {
            return;
        }

        removedFileIds.forEach((fileId) => mlFilesStore.removeItem(fileId));
        console.log('Removed local file ids: ', removedFileIds);

        await incrementIndexVersion('files');
    }

    // TODO: optimize, use indexdb indexes, move facecrops to cache to reduce io
    private async getUniqueOutOfSyncFiles(
        syncContext: MLSyncContext,
        files: File[]
    ) {
        const limit = syncContext.config.batchSize;
        const mlVersion = syncContext.config.mlVersion;
        const uniqueFiles: Map<number, File> = new Map<number, File>();
        for (let i = 0; uniqueFiles.size < limit && i < files.length; i++) {
            const mlFileData = await this.getMLFileData(files[i].id.toString());
            const mlFileVersion = mlFileData?.mlVersion || 0;
            if (
                !uniqueFiles.has(files[i].id) &&
                (!mlFileData?.errorCount || mlFileData.errorCount < 2) &&
                (mlFileVersion < mlVersion ||
                    syncContext.config.imageSource !== mlFileData.imageSource)
            ) {
                uniqueFiles.set(files[i].id, files[i]);
            }
        }

        return [...uniqueFiles.values()];
    }

    private async getOutOfSyncFiles(syncContext: MLSyncContext) {
        const existingFiles = await this.getLocalFiles(syncContext);
        // existingFiles.sort(
        //     (a, b) => b.metadata.creationTime - a.metadata.creationTime
        // );
        console.time('getUniqueOutOfSyncFiles');
        syncContext.outOfSyncFiles = await this.getUniqueOutOfSyncFiles(
            syncContext,
            existingFiles
        );
        console.timeEnd('getUniqueOutOfSyncFiles');
        console.log(
            'Got unique outOfSyncFiles: ',
            syncContext.outOfSyncFiles.length,
            'for batchSize: ',
            syncContext.config.batchSize
        );
    }

    private async syncFiles(syncContext: MLSyncContext) {
        for (const outOfSyncfile of syncContext.outOfSyncFiles) {
            syncContext.syncQueue.add(async () => {
                try {
                    const mlFileData = await this.syncFile(
                        syncContext,
                        outOfSyncfile
                    );
                    mlFileData.faces &&
                        syncContext.syncedFaces.push(...mlFileData.faces);
                    syncContext.syncedFiles.push(outOfSyncfile);
                    console.log('TF Memory stats: ', tf.memory());
                } catch (e) {
                    console.error(
                        'Error while syncing file: ',
                        outOfSyncfile.id,
                        e
                    );

                    await this.persistMLFileSyncError(
                        syncContext,
                        outOfSyncfile,
                        e
                    );
                }
            });
        }
        // TODO: can use addAll instead
        await syncContext.syncQueue.onIdle();
        console.log('allFaces: ', syncContext.syncedFaces);

        await incrementIndexVersion('files');
        // await this.disposeMLModels();
    }

    public async syncLocalFile(
        token: string,
        enteFile: File,
        localFile: globalThis.File,
        config?: MLSyncConfig
    ) {
        const mlSyncConfig = config || (await getMLSyncConfig());
        const syncContext = MLFactory.getMLSyncContext(
            token,
            mlSyncConfig,
            false
        );
        // await this.init();

        try {
            const mlFileData = await this.syncFile(
                syncContext,
                enteFile,
                localFile
            );
            await syncContext.dispose();
            return mlFileData;
        } catch (e) {
            console.error('Error while syncing local file: ', enteFile.id, e);
            await this.persistMLFileSyncError(syncContext, enteFile, e);
        }
    }

    private async syncFile(
        syncContext: MLSyncContext,
        enteFile: File,
        localFile?: globalThis.File
    ) {
        const fileContext: MLSyncFileContext = { enteFile, localFile };
        fileContext.oldMLFileData = await this.getMLFileData(
            enteFile.id.toString()
        );
        if (!fileContext.oldMLFileData) {
            fileContext.newMLFileData = newMlData(syncContext, enteFile);
        } else if (
            fileContext.oldMLFileData?.mlVersion ===
                syncContext.config.mlVersion &&
            fileContext.oldMLFileData?.imageSource ===
                syncContext.config.imageSource
        ) {
            return fileContext.oldMLFileData;
        } else {
            fileContext.newMLFileData = { ...fileContext.oldMLFileData };
            fileContext.newMLFileData.imageSource =
                syncContext.config.imageSource;
        }

        if (syncContext.shouldUpdateMLVersion) {
            fileContext.newMLFileData.mlVersion = syncContext.config.mlVersion;
        }

        await this.syncFileFaceDetections(syncContext, fileContext);

        if (
            fileContext.filtertedFaces &&
            fileContext.filtertedFaces.length > 0
        ) {
            await this.syncFileFaceCrops(syncContext, fileContext);

            await this.syncFileFaceAlignments(syncContext, fileContext);

            await this.syncFileFaceEmbeddings(syncContext, fileContext);

            fileContext.newMLFileData.faces =
                fileContext.facesWithEmbeddings?.map(
                    (faceWithEmbeddings) =>
                        ({
                            fileId: enteFile.id,

                            ...faceWithEmbeddings,
                        } as Face)
                );
        } else {
            fileContext.newMLFileData.faces = undefined;
        }

        fileContext.tfImage && fileContext.tfImage.dispose();
        fileContext.imageBitmap && fileContext.imageBitmap.close();
        // console.log('8 TF Memory stats: ', tf.memory());
        await this.persistMLFileData(syncContext, fileContext.newMLFileData);

        return fileContext.newMLFileData;
    }

    private async getImageBitmap(
        syncContext: MLSyncContext,
        fileContext: MLSyncFileContext
    ) {
        // console.log('1 TF Memory stats: ', tf.memory());
        if (fileContext.localFile) {
            fileContext.imageBitmap = await getLocalFileImageBitmap(
                fileContext.localFile
            );
            // fileContext.newMLFileData.imageSource = 'Original';
        } else if (
            syncContext.config.imageSource === 'Original' &&
            [FILE_TYPE.IMAGE, FILE_TYPE.LIVE_PHOTO].includes(
                fileContext.enteFile.metadata.fileType
            )
        ) {
            fileContext.imageBitmap = await getOriginalImageBitmap(
                fileContext.enteFile,
                syncContext.token,
                await syncContext.getEnteWorker(fileContext.enteFile.id)
            );
            // fileContext.newMLFileData.imageSource = 'Original';
        } else {
            fileContext.imageBitmap = await getThumbnailImageBitmap(
                fileContext.enteFile,
                syncContext.token
            );
            // fileContext.newMLFileData.imageSource = 'Preview';
        }

        if (!fileContext.newMLFileData.imageDimentions) {
            const { width, height } = fileContext.imageBitmap;
            fileContext.newMLFileData.imageDimentions = { width, height };
        }
        // console.log('2 TF Memory stats: ', tf.memory());
    }

    private async syncFileFaceDetections(
        syncContext: MLSyncContext,
        fileContext: MLSyncFileContext
    ) {
        if (
            isDifferentOrOld(
                fileContext.oldMLFileData?.detectionMethod,
                syncContext.faceDetectionService.method
            ) ||
            fileContext.oldMLFileData?.imageSource !==
                syncContext.config.imageSource
        ) {
            fileContext.newDetection = true;
            await this.getImageBitmap(syncContext, fileContext);
            const detectedFaces =
                await syncContext.faceDetectionService.detectFaces(
                    fileContext.imageBitmap
                );
            // console.log('3 TF Memory stats: ', tf.memory());
            // TODO: reenable faces filtering based on width
            fileContext.filtertedFaces = detectedFaces;
            // ?.filter((f) =>
            //     f.box.width > syncContext.config.faceDetection.minFaceSize
            // );
            console.log(
                '[MLService] filtertedFaces: ',
                fileContext.filtertedFaces?.length
            );
        } else {
            fileContext.filtertedFaces = fileContext.oldMLFileData.faces;
        }
    }

    private async syncFileFaceCrops(
        syncContext: MLSyncContext,
        fileContext: MLSyncFileContext
    ) {
        const imageBitmap = fileContext.imageBitmap;
        if (
            !fileContext.newDetection ||
            !syncContext.config.faceCrop.enabled ||
            !imageBitmap
        ) {
            return;
        }

        for (const face of fileContext.filtertedFaces) {
            face.faceCrop = await syncContext.faceCropService.getFaceCrop(
                imageBitmap,
                face,
                syncContext.config.faceCrop
            );
        }
    }

    private async syncFileFaceAlignments(
        syncContext: MLSyncContext,
        fileContext: MLSyncFileContext
    ) {
        if (
            fileContext.newDetection ||
            isDifferentOrOld(
                fileContext.oldMLFileData?.alignmentMethod,
                syncContext.faceAlignmentService.method
            )
        ) {
            fileContext.newAlignment = true;
            fileContext.alignedFaces =
                syncContext.faceAlignmentService.getAlignedFaces(
                    fileContext.filtertedFaces
                );
            console.log(
                '[MLService] alignedFaces: ',
                fileContext.alignedFaces?.length
            );
            // console.log('4 TF Memory stats: ', tf.memory());
        } else {
            fileContext.alignedFaces = fileContext.oldMLFileData.faces;
        }
    }

    private async syncFileFaceEmbeddings(
        syncContext: MLSyncContext,
        fileContext: MLSyncFileContext
    ) {
        if (
            fileContext.newAlignment ||
            isDifferentOrOld(
                fileContext.oldMLFileData?.embeddingMethod,
                syncContext.faceEmbeddingService.method
            )
        ) {
            // TODO: when not storing face crops image will be needed to extract faces
            // fileContext.imageBitmap ||
            //     (await this.getImageBitmap(syncContext, fileContext));
            fileContext.facesWithEmbeddings =
                await syncContext.faceEmbeddingService.getFaceEmbeddings(
                    fileContext.imageBitmap,
                    fileContext.alignedFaces
                );
            console.log(
                '[MLService] facesWithEmbeddings: ',
                fileContext.facesWithEmbeddings
            );
            // console.log('5 TF Memory stats: ', tf.memory());
        } else {
            fileContext.facesWithEmbeddings = fileContext.oldMLFileData?.faces;
        }
    }

    public async init() {
        if (this.initialized) {
            return;
        }

        await tf.ready();

        console.log('01 TF Memory stats: ', tf.memory());
        // await tfjsFaceDetectionService.init();
        // // console.log('02 TF Memory stats: ', tf.memory());
        // await this.faceLandmarkService.init();
        // await faceapi.nets.faceLandmark68Net.loadFromUri('/models/face-api/');
        // // console.log('03 TF Memory stats: ', tf.memory());
        // await tfjsFaceEmbeddingService.init();
        // await faceapi.nets.faceRecognitionNet.loadFromUri('/models/face-api/');
        // console.log('04 TF Memory stats: ', tf.memory());

        this.initialized = true;
    }

    public async dispose() {
        this.initialized = false;
        // await this.faceDetectionService.dispose();
        // console.log('11 TF Memory stats: ', tf.memory());
        // await this.faceLandmarkService.dispose();
        // console.log('12 TF Memory stats: ', tf.memory());
        // await this.faceEmbeddingService.dispose();
        // console.log('13 TF Memory stats: ', tf.memory());
    }

    private async getMLFileData(fileId: string) {
        return mlFilesStore.getItem<MlFileData>(fileId);
    }

    private async persistMLFileData(
        syncContext: MLSyncContext,
        mlFileData: MlFileData
    ) {
        return mlFilesStore.setItem(mlFileData.fileId.toString(), mlFileData);
    }

    private async persistMLFileSyncError(
        syncContext: MLSyncContext,
        enteFile: File,
        e: Error
    ) {
        try {
            const oldMlFileData = await this.getMLFileData(
                enteFile.id.toString()
            );
            let mlFileData = oldMlFileData;
            if (!mlFileData) {
                mlFileData = newMlData(syncContext, enteFile);
            }
            mlFileData.errorCount = (mlFileData.errorCount || 0) + 1;
            mlFileData.lastErrorMessage = e.message;
            return mlFilesStore.setItem(
                mlFileData.fileId.toString(),
                mlFileData
            );
        } catch (e) {
            // TODO: logError or stop sync job after most of the requests are failed
            console.error('Error while storing ml sync error', e);
        }
    }

    private async getMLLibraryData(syncContext: MLSyncContext) {
        syncContext.mlLibraryData = await mlLibraryStore.getItem<MLLibraryData>(
            'data'
        );
        if (!syncContext.mlLibraryData) {
            syncContext.mlLibraryData = {};
        }
    }

    private async persistMLLibraryData(syncContext: MLSyncContext) {
        return mlLibraryStore.setItem('data', syncContext.mlLibraryData);
    }

    public async syncIndex(syncContext: MLSyncContext) {
        await this.getMLLibraryData(syncContext);

        // await this.init();
        await this.syncPeopleIndex(syncContext);

        await this.persistMLLibraryData(syncContext);
    }

    private async syncPeopleIndex(syncContext: MLSyncContext) {
        const filesVersion = await getIndexVersion('files');
        if (
            filesVersion <= (await getIndexVersion('people')) &&
            !isDifferentOrOld(
                syncContext.mlLibraryData?.faceClusteringMethod,
                syncContext.faceClusteringService.method
            )
        ) {
            console.log(
                '[MLService] Skipping people index as already synced to latest version'
            );
            return;
        }

        // TODO: have faces addresable through fileId + faceId
        // to avoid index based addressing, which is prone to wrong results
        // one way could be to match nearest face within threshold in the file
        const allFacesMap = await this.getAllSyncedFacesMap(syncContext);
        const allFaces = getAllFacesFromMap(allFacesMap);

        await this.runFaceClustering(syncContext, allFaces);
        await this.syncPeopleFromClusters(syncContext, allFacesMap, allFaces);

        await setIndexVersion('people', filesVersion);
    }

    private async getAllSyncedFacesMap(syncContext: MLSyncContext) {
        if (syncContext.allSyncedFacesMap) {
            return syncContext.allSyncedFacesMap;
        }

        syncContext.allSyncedFacesMap = await getAllFacesMap();
        return syncContext.allSyncedFacesMap;
    }

    public async runFaceClustering(
        syncContext: MLSyncContext,
        allFaces: Array<Face>
    ) {
        // await this.init();

        const clusteringConfig = syncContext.config.faceClustering;

        if (!allFaces || allFaces.length < clusteringConfig.minInputSize) {
            console.log(
                '[MLService] Too few faces to cluster, not running clustering: ',
                allFaces.length
            );
            return;
        }

        console.log('Running clustering allFaces: ', allFaces.length);
        syncContext.mlLibraryData.faceClusteringResults =
            await syncContext.faceClusteringService.cluster(
                allFaces.map((f) => Array.from(f.embedding)),
                syncContext.config.faceClustering
            );
        syncContext.mlLibraryData.faceClusteringMethod =
            syncContext.faceClusteringService.method;
        console.log(
            '[MLService] Got face clustering results: ',
            syncContext.mlLibraryData.faceClusteringResults
        );

        // syncContext.faceClustersWithNoise = {
        //     clusters: syncContext.faceClusteringResults.clusters.map(
        //         (faces) => ({
        //             faces,
        //         })
        //     ),
        //     noise: syncContext.faceClusteringResults.noise,
        // };
    }

    private async syncPeopleFromClusters(
        syncContext: MLSyncContext,
        allFacesMap: Map<number, Array<Face>>,
        allFaces: Array<Face>
    ) {
        const clusters =
            syncContext.mlLibraryData.faceClusteringResults?.clusters;
        if (!clusters || clusters.length < 1) {
            return;
        }

        await mlPeopleStore.clear();
        for (const [index, cluster] of clusters.entries()) {
            const faces = cluster.map((f) => allFaces[f]).filter((f) => f);

            const personFace = findFirstIfSorted(
                faces,
                (a, b) => a.probability * a.size - b.probability * b.size
            );

            let faceImage = personFace.faceCrop?.image;
            if (!faceImage) {
                faceImage = await getFaceImage(personFace, syncContext.token);
            }

            const person: Person = {
                id: index,
                files: faces.map((f) => f.fileId),
                faceImage,
            };

            await mlPeopleStore.setItem(person.id.toString(), person);

            faces.forEach((face) => {
                face.personId = person.id;
            });
            // console.log("Creating person: ", person, faces);
        }

        await mlFilesStore.iterate((mlFileData: MlFileData, key) => {
            mlFileData.faces = allFacesMap.get(mlFileData.fileId);
            mlFilesStore.setItem(key, mlFileData);
        });
    }

    private async runTSNE(syncContext: MLSyncContext) {
        let faces = syncContext.syncedFaces;
        if (!faces || faces.length < 1) {
            const allFacesMap = await this.getAllSyncedFacesMap(syncContext);
            faces = getAllFacesFromMap(allFacesMap);
        }

        const input = faces
            .slice(0, syncContext.config.tsne.samples)
            .map((f) => f.embedding);
        syncContext.tsne = toTSNE(input, syncContext.config.tsne);
        console.log('tsne: ', syncContext.tsne);
    }
}

export default new MachineLearningService();