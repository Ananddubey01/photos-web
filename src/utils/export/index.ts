import { ExportRecord } from 'services/exportService';
import { File } from 'services/fileService';
import { MetadataObject } from 'services/uploadService';
import { formatDate } from 'utils/file';


export const getFileUID = (file: File) => `${file.id}_${file.collectionID}_${file.updationTime}`;


export const getExportPendingFiles = async (allFiles: File[], exportRecord: ExportRecord) => {
    const queuedFiles = new Set(exportRecord?.queuedFiles);
    const unExportedFiles = allFiles.filter((file) => {
        const fileUID = `${file.id}_${file.collectionID}`;
        if (queuedFiles.has(fileUID)) {
            return file;
        }
    });
    return unExportedFiles;
};

export const getFilesUploadedAfterLastExport = async (allFiles: File[], exportRecord: ExportRecord) => {
    const exportedFiles = new Set(exportRecord?.exportedFiles);
    const unExportedFiles = allFiles.filter((file) => {
        const fileUID = `${file.id}_${file.collectionID}`;
        if (!exportedFiles.has(fileUID)) {
            return file;
        }
    });
    return unExportedFiles;
};

export const getExportFailedFiles = async (allFiles: File[], exportRecord: ExportRecord) => {
    const failedFiles = new Set(exportRecord?.failedFiles);
    const filesToExport = allFiles.filter((file) => {
        if (failedFiles.has(`${file.id}_${file.collectionID}`)) {
            return file;
        }
    });
    return filesToExport;
};

export const dedupe = (files: any[]) => {
    const fileSet = new Set(files);
    const dedupedArray = new Array(...fileSet);
    return dedupedArray;
};

export const getGoogleLikeMetadataFile=(uid :string, metadata:MetadataObject)=>{
    return JSON.stringify({
        title: uid,
        creationTime: {
            timestamp: metadata.creationTime,
            formatted: formatDate(metadata.creationTime),
        },
        modificationTime: {
            timestamp: metadata.modificationTime,
            formatted: formatDate(metadata.modificationTime),
        },
        geoData: {
            latitude: metadata.latitude,
            longitude: metadata.longitude,
        },
    }, null, 2);
};