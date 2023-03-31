import ExpandMore from '@mui/icons-material/ExpandMore';
import {
    Box,
    MenuItem,
    Select,
    SelectChangeEvent,
    Stack,
    Typography,
    TypographyTypeMap,
} from '@mui/material';

export interface DropdownOption<T> {
    label: string;
    value: T;
}

interface Iprops<T> {
    label: string;
    labelProps: TypographyTypeMap['props'];
    options: DropdownOption<T>[];
    message?: string;
    selectedValue: string;
    setSelectedValue: (selectedValue: T) => void;
    placeholder?: string;
}

export default function DropdownInput<T extends string>({
    label,
    labelProps,
    options,
    message,
    selectedValue,
    placeholder,
    setSelectedValue,
}: Iprops<T>) {
    return (
        <Stack spacing={'4px'}>
            <Typography {...labelProps}>{label}</Typography>
            <Select
                IconComponent={ExpandMore}
                displayEmpty
                variant="standard"
                MenuProps={{
                    MenuListProps: {
                        sx: (theme) => ({
                            backgroundColor: theme.palette.background.overPaper,
                            '.MuiMenuItem-root ': {
                                color: theme.palette.text.secondary,
                            },
                            '&& > .Mui-selected': {
                                background: theme.palette.background.overPaper,
                                color: theme.palette.text.primary,
                            },
                        }),
                    },
                }}
                sx={(theme) => ({
                    '::before , ::after': {
                        borderBottom: 'none !important',
                    },
                    '.MuiSelect-select': {
                        background: theme.palette.fill.dark,
                        borderRadius: '8px',
                    },
                    '&&& .MuiSelect-select': {
                        p: '12px 36px 12px 16px',
                    },
                    '.MuiSelect-icon': {
                        mr: '12px',
                        color: theme.palette.stroke.muted,
                    },
                })}
                renderValue={(selected) => {
                    return !selected?.length ? (
                        <Box color={'text.secondary'}>{placeholder ?? ''}</Box>
                    ) : (
                        options.find((o) => o.value === selected).label
                    );
                }}
                value={selectedValue}
                onChange={(event: SelectChangeEvent) => {
                    setSelectedValue(event.target.value as T);
                }}>
                {options.map((option, index) => (
                    <MenuItem
                        key={option.label}
                        divider={index !== options.length - 1}
                        value={option.value}
                        sx={{
                            px: '16px',
                            py: '14px',
                            color: (theme) => theme.palette.primary.main,
                        }}>
                        {option.label}
                    </MenuItem>
                ))}
            </Select>
            {message && (
                <Typography px={'8px'} color={'text.secondary'}>
                    {message}
                </Typography>
            )}
        </Stack>
    );
}
