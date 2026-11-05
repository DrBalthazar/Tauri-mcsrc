// src/ui/SourceExportModal.tsx
import { Alert, Button, Flex, Modal, Spin, Typography } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { BehaviorSubject } from "rxjs";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useObservable } from "../utils/UseObservable";
import { minecraftJar } from "../logic/MinecraftApi";
import {
    sourceExportState,
    exportVersionSources,
    resetSourceExport,
} from "../logic/SourceExporter";

export const sourceExportModalOpen = new BehaviorSubject(false);

export const SourceExportModal = () => {
    const open$ = useObservable(sourceExportModalOpen);
    const state = useObservable(sourceExportState);
    const jar = useObservable(minecraftJar);
    const [busy, setBusy] = useState(false);

    const version = jar?.version ?? "";
    const isRunning = state?.status === 'decompiling' || state?.status === 'copying';

    const handlePickAndExport = async () => {
        if (!version) return;

        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: `Choose where to export ${version} sources`,
            });

            if (!selected || typeof selected !== "string") return;

            setBusy(true);
            await exportVersionSources(version, selected);
        } catch (err) {
            console.error("[export] failed", err);
        } finally {
            setBusy(false);
        }
    };

    const handleClose = () => {
        if (isRunning) return;
        resetSourceExport();
        sourceExportModalOpen.next(false);
    };

    return (
        <Modal
            title="Export Sources"
            open={open$}
            onCancel={handleClose}
            maskClosable={!isRunning}
            closable={!isRunning}
            footer={null}
            width={560}
        >
            {!version && (
                <Alert type="info" showIcon message="No Minecraft version loaded yet." />
            )}

            {version && (
                <>
                    <Typography.Paragraph>
                        Export all decompiled sources of <strong>{version}</strong> to a folder on your disk.
                        A subfolder named <code>{version}</code> will be created inside the selected folder,
                        containing all package files (<code>net/</code>, <code>com/</code>, <code>assets/</code>, ...).
                    </Typography.Paragraph>

                    {!state && (
                        <Button
                            type="primary"
                            icon={<FolderOpenOutlined />}
                            onClick={handlePickAndExport}
                            loading={busy}
                            block
                            size="large"
                        >
                            Choose folder & start export
                        </Button>
                    )}

                    {state && (
                        <Flex vertical gap={12} style={{ marginTop: 8 }}>
                            {isRunning && (
                                <Flex align="center" gap={10}>
                                    <Spin />
                                    <Typography.Text>{state.message}</Typography.Text>
                                </Flex>
                            )}

                            {state.status === 'done' && (
                                <Alert type="success" showIcon message={state.message} />
                            )}

                            {state.status === 'error' && (
                                <Alert
                                    type="error"
                                    showIcon
                                    message={state.message}
                                    description={state.error}
                                />
                            )}

                            {state.status === 'cancelled' && (
                                <Alert type="warning" showIcon message="Export cancelled" />
                            )}

                            {!isRunning && (
                                <Button onClick={handleClose}>Close</Button>
                            )}
                        </Flex>
                    )}
                </>
            )}
        </Modal>
    );
};