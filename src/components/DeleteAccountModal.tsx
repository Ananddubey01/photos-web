import { Button, Link, Stack } from '@mui/material';
import { AppContext } from 'pages/_app';
import { useContext, useEffect, useState } from 'react';
import { preloadImage, initiateEmail } from 'utils/common';
import {
    deleteAccount,
    getAccountDeleteChallenge,
    logoutUser,
} from 'services/userService';
import AuthenticateUserModal from './AuthenticateUserModal';
import { logError } from 'utils/sentry';
import { decryptDeleteAccountChallenge } from 'utils/crypto';
import { Trans } from 'react-i18next';
import { t } from 'i18next';
import { DELETE_ACCOUNT_EMAIL } from 'constants/urls';
import DialogBoxV2 from './DialogBoxV2';
import * as Yup from 'yup';
import { Formik, FormikHelpers } from 'formik';
import DropdownInput, { DropdownOption } from './DropdownInput';
import MultilineInput from './MultilineInput';
import { CheckboxInput } from './CheckboxInput';
import EnteButton from './EnteButton';

interface Iprops {
    onClose: () => void;
    open: boolean;
}

interface FormValues {
    reason: string;
    feedback: string;
}

enum DELETE_REASON {
    MISSING_FEATURE = '0',
    BROKEN_BEHAVIOR = '1',
    FOUND_ANOTHER_SERVICE = '2',
    USING_DIFFERENT_ACCOUNT = '3',
    NOT_LISTED = '4',
}

const getReasonOptions = (): DropdownOption<DELETE_REASON>[] => {
    return [
        {
            label: t('DELETE_REASON.MISSING_FEATURE'),
            value: DELETE_REASON.MISSING_FEATURE,
        },
        {
            label: t('DELETE_REASON.BROKEN_BEHAVIOR'),
            value: DELETE_REASON.BROKEN_BEHAVIOR,
        },
        {
            label: t('DELETE_REASON.FOUND_ANOTHER_SERVICE'),
            value: DELETE_REASON.FOUND_ANOTHER_SERVICE,
        },
        {
            label: t('DELETE_REASON.USING_DIFFERENT_ACCOUNT'),
            value: DELETE_REASON.USING_DIFFERENT_ACCOUNT,
        },
        {
            label: t('DELETE_REASON.NOT_LISTED'),
            value: DELETE_REASON.NOT_LISTED,
        },
    ];
};

const REASON_WITH_REQUIRED_FEEDBACK = new Set([
    DELETE_REASON.MISSING_FEATURE,
    DELETE_REASON.BROKEN_BEHAVIOR,
    DELETE_REASON.NOT_LISTED,
]);

const DeleteAccountModal = ({ open, onClose }: Iprops) => {
    const { setDialogBoxAttributesV2, isMobile } = useContext(AppContext);
    const [loading, setLoading] = useState(false);
    const [authenticateUserModalView, setAuthenticateUserModalView] =
        useState(false);
    const [deleteAccountChallenge, setDeleteAccountChallenge] = useState('');

    const openAuthenticateUserModal = () => setAuthenticateUserModalView(true);
    const closeAuthenticateUserModal = () =>
        setAuthenticateUserModalView(false);
    const [acceptDataDeletion, setAcceptDataDeletion] = useState(false);

    useEffect(() => {
        preloadImage('/images/delete-account');
    }, []);

    const somethingWentWrong = () =>
        setDialogBoxAttributesV2({
            title: t('ERROR'),
            close: { variant: 'critical' },
            content: t('UNKNOWN_ERROR'),
        });

    const initiateDelete = async (
        { reason, feedback }: FormValues,
        { setFieldError }: FormikHelpers<FormValues>
    ) => {
        try {
            if (
                REASON_WITH_REQUIRED_FEEDBACK.has(reason as DELETE_REASON) &&
                !feedback?.length
            ) {
                setFieldError('feedback', t('FEEDBACK_REQUIRED'));
                return;
            }
            setLoading(true);
            const deleteChallengeResponse = await getAccountDeleteChallenge();
            setDeleteAccountChallenge(
                deleteChallengeResponse.encryptedChallenge
            );
            if (deleteChallengeResponse.allowDelete) {
                openAuthenticateUserModal();
            } else {
                askToMailForDeletion();
            }
        } catch (e) {
            logError(e, 'Error while initiating account deletion');
            somethingWentWrong();
        } finally {
            setLoading(false);
        }
    };

    const confirmAccountDeletion = () => {
        setDialogBoxAttributesV2({
            title: t('DELETE_ACCOUNT'),
            content: <Trans i18nKey="CONFIRM_ACCOUNT_DELETION_MESSAGE" />,
            proceed: {
                text: t('DELETE'),
                action: solveChallengeAndDeleteAccount,
                variant: 'critical',
            },
            close: { text: t('CANCEL') },
        });
    };

    const askToMailForDeletion = () => {
        setDialogBoxAttributesV2({
            title: t('DELETE_ACCOUNT'),
            content: (
                <Trans
                    i18nKey="DELETE_ACCOUNT_MESSAGE"
                    components={{
                        a: <Link href={`mailto:${DELETE_ACCOUNT_EMAIL}`} />,
                    }}
                    values={{ emailID: DELETE_ACCOUNT_EMAIL }}
                />
            ),
            proceed: {
                text: t('DELETE'),
                action: () => {
                    initiateEmail('account-deletion@ente.io');
                },
                variant: 'critical',
            },
            close: { text: t('CANCEL') },
        });
    };

    const solveChallengeAndDeleteAccount = async (
        setLoading: (value: boolean) => void
    ) => {
        try {
            setLoading(true);
            const decryptedChallenge = await decryptDeleteAccountChallenge(
                deleteAccountChallenge
            );
            await deleteAccount(decryptedChallenge);
            logoutUser();
        } catch (e) {
            logError(e, 'solveChallengeAndDeleteAccount failed');
            somethingWentWrong();
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <DialogBoxV2
                fullWidth
                open={open}
                onClose={onClose}
                fullScreen={isMobile}
                attributes={{
                    title: t('DELETE_ACCOUNT'),
                    secondary: {
                        action: onClose,
                        text: t('CANCEL'),
                    },
                }}>
                <Formik<FormValues>
                    initialValues={{
                        reason: '',
                        feedback: '',
                    }}
                    validationSchema={Yup.object().shape({
                        reason: Yup.string().required(t('REQUIRED')),
                    })}
                    validateOnChange={false}
                    validateOnBlur={false}
                    onSubmit={initiateDelete}>
                    {({
                        values,
                        errors,
                        handleChange,
                        handleSubmit,
                    }): JSX.Element => (
                        <form noValidate onSubmit={handleSubmit}>
                            <Stack spacing={'24px'}>
                                <DropdownInput
                                    options={getReasonOptions()}
                                    label={t('DELETE_ACCOUNT_REASON_LABEL')}
                                    placeholder={t(
                                        'DELETE_ACCOUNT_REASON_PLACEHOLDER'
                                    )}
                                    selected={values.reason}
                                    setSelected={handleChange('reason')}
                                    messageProps={{ color: 'critical.main' }}
                                    message={errors.reason}
                                />
                                <MultilineInput
                                    label={t('DELETE_ACCOUNT_FEEDBACK_LABEL')}
                                    placeholder={t(
                                        'DELETE_ACCOUNT_FEEDBACK_PLACEHOLDER'
                                    )}
                                    value={values.feedback}
                                    onChange={handleChange('feedback')}
                                    message={errors.feedback}
                                    messageProps={{ color: 'critical.main' }}
                                    rowCount={3}
                                />
                                <CheckboxInput
                                    checked={acceptDataDeletion}
                                    onChange={setAcceptDataDeletion}
                                    label={t(
                                        'CONFIRM_DELETE_ACCOUNT_CHECKBOX_LABEL'
                                    )}
                                />
                                <Stack spacing={'8px'}>
                                    <EnteButton
                                        type="submit"
                                        size="large"
                                        color="critical"
                                        disabled={!acceptDataDeletion}
                                        loading={loading}>
                                        {t('CONFIRM_DELETE_ACCOUNT')}
                                    </EnteButton>
                                    <Button
                                        size="large"
                                        color={'secondary'}
                                        onClick={onClose}>
                                        {t('CANCEL')}
                                    </Button>
                                </Stack>
                            </Stack>
                        </form>
                    )}
                </Formik>
            </DialogBoxV2>
            <AuthenticateUserModal
                open={authenticateUserModalView}
                onClose={closeAuthenticateUserModal}
                onAuthenticate={confirmAccountDeletion}
            />
        </>
    );
};

export default DeleteAccountModal;
