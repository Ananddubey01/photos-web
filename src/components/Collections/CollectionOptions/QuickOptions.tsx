import { CollectionActions } from '.';
import React from 'react';
import { CollectionSummaryType } from 'constants/collection';
import PeopleIcon from '@mui/icons-material/People';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { FlexWrapper } from 'components/Container';
import { IconButton, Tooltip } from '@mui/material';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import constants from 'utils/strings/constants';

interface Iprops {
    handleCollectionAction: (
        action: CollectionActions,
        loader?: boolean
    ) => (...args: any[]) => Promise<void>;
    collectionSummaryType: CollectionSummaryType;
}

export function QuickOptions({
    handleCollectionAction,
    collectionSummaryType,
}: Iprops) {
    return (
        <FlexWrapper sx={{ gap: '16px' }}>
            {!(
                collectionSummaryType === CollectionSummaryType.trash ||
                collectionSummaryType === CollectionSummaryType.favorites ||
                collectionSummaryType === CollectionSummaryType.uncategorized ||
                collectionSummaryType === CollectionSummaryType.incomingShare
            ) && (
                <Tooltip
                    title={
                        /*: collectionSummaryType ===
                            CollectionSummaryType.incomingShare
                          ? constants.SHARING_DETAILS*/
                        collectionSummaryType ===
                        CollectionSummaryType.outgoingShare
                            ? constants.MODIFY_SHARING
                            : constants.SHARE_COLLECTION
                    }>
                    <IconButton
                        onClick={handleCollectionAction(
                            CollectionActions.SHOW_SHARE_DIALOG,
                            false
                        )}>
                        <PeopleIcon />
                    </IconButton>
                </Tooltip>
            )}
            {!(collectionSummaryType === CollectionSummaryType.trash) && (
                <Tooltip
                    title={
                        collectionSummaryType ===
                        CollectionSummaryType.favorites
                            ? constants.DOWNLOAD_FAVORITES
                            : collectionSummaryType ===
                              CollectionSummaryType.uncategorized
                            ? constants.DOWNLOAD_UNCATEGORIZED
                            : constants.DOWNLOAD_COLLECTION
                    }>
                    <IconButton
                        onClick={handleCollectionAction(
                            CollectionActions.CONFIRM_DOWNLOAD,
                            false
                        )}>
                        <FileDownloadOutlinedIcon />
                    </IconButton>
                </Tooltip>
            )}
            {collectionSummaryType === CollectionSummaryType.trash && (
                <Tooltip title={constants.EMPTY_TRASH}>
                    <IconButton
                        onClick={handleCollectionAction(
                            CollectionActions.CONFIRM_EMPTY_TRASH,
                            false
                        )}>
                        <DeleteOutlinedIcon />
                    </IconButton>
                </Tooltip>
            )}
        </FlexWrapper>
    );
}
