import { FILE_TYPE } from 'constants/file';
import { MLSyncContext, MLSyncFileContext } from 'types/machineLearning';
import {
    getLocalFileImageBitmap,
    getOriginalImageBitmap,
    getThumbnailImageBitmap,
} from 'utils/machineLearning';

class ReaderService {
    async getImageBitmap(
        syncContext: MLSyncContext,
        fileContext: MLSyncFileContext
    ) {
        if (fileContext.imageBitmap) {
            return fileContext.imageBitmap;
        }
        // console.log('1 TF Memory stats: ', tf.memory());
        if (fileContext.localFile) {
            if (fileContext.enteFile.metadata.fileType !== FILE_TYPE.IMAGE) {
                throw new Error('Local file of only image type is supported');
            }
            fileContext.imageBitmap = await getLocalFileImageBitmap(
                fileContext.enteFile,
                fileContext.localFile
            );
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
        } else {
            fileContext.imageBitmap = await getThumbnailImageBitmap(
                fileContext.enteFile,
                syncContext.token
            );
        }

        fileContext.newMlFile.imageSource = syncContext.config.imageSource;
        const { width, height } = fileContext.imageBitmap;
        fileContext.newMlFile.imageDimensions = { width, height };
        // console.log('2 TF Memory stats: ', tf.memory());

        return fileContext.imageBitmap;
    }
}
export default new ReaderService();