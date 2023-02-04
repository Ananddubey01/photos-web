import React, { useContext, useState, useEffect } from 'react';
import constants from 'utils/strings/constants';
import { GalleryContext } from 'pages/gallery';
import {
    ARCHIVE_SECTION,
    DUMMY_UNCATEGORIZED_SECTION,
    TRASH_SECTION,
} from 'constants/collection';
import { CollectionSummaries } from 'types/collection';
import ShortcutButton from './ShortcutButton';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import CategoryIcon from '@mui/icons-material/Category';
import { getUncategorizedCollection } from 'services/collectionService';
interface Iprops {
    closeSidebar: () => void;
    collectionSummaries: CollectionSummaries;
}

export default function ShortcutSection({
    closeSidebar,
    collectionSummaries,
}: Iprops) {
    const galleryContext = useContext(GalleryContext);
    const [uncategorizedCollectionId, setUncategorizedCollectionID] =
        useState<number>();
    useEffect(() => {
        const main = async () => {
            const unCategorizedCollection = await getUncategorizedCollection();
            if (unCategorizedCollection) {
                setUncategorizedCollectionID(unCategorizedCollection.id);
            } else {
                setUncategorizedCollectionID(DUMMY_UNCATEGORIZED_SECTION);
            }
        };
        main();
    }, []);

    const openUncategorizedSection = () => {
        galleryContext.setActiveCollection(uncategorizedCollectionId);
        closeSidebar();
    };

    const openTrashSection = () => {
        galleryContext.setActiveCollection(TRASH_SECTION);
        closeSidebar();
    };

    const openArchiveSection = () => {
        galleryContext.setActiveCollection(ARCHIVE_SECTION);
        closeSidebar();
    };
    return (
        <>
            <ShortcutButton
                startIcon={<CategoryIcon />}
                label={constants.UNCATEGORIZED}
                onClick={openUncategorizedSection}
                count={
                    collectionSummaries.get(uncategorizedCollectionId)
                        ?.fileCount
                }
            />
            <ShortcutButton
                startIcon={<DeleteOutline />}
                label={constants.TRASH}
                count={collectionSummaries.get(TRASH_SECTION)?.fileCount}
                onClick={openTrashSection}
            />
            <ShortcutButton
                startIcon={<ArchiveOutlined />}
                label={constants.ARCHIVE_SECTION_NAME}
                count={collectionSummaries.get(ARCHIVE_SECTION)?.fileCount}
                onClick={openArchiveSection}
            />
        </>
    );
}
