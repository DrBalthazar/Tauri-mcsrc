// src/ui/DecompileProgressModal.tsx
import { Modal, Progress, Typography, Flex, Button } from "antd";
import { useObservable } from "../utils/UseObservable";
import { decompileProgress, cancelDecompile } from "../logic/SourceCache";
import { sourceExportState } from "../logic/SourceExporter";

export const DecompileProgressModal = () => {
    const progress = useObservable(decompileProgress);
    const exportState = useObservable(sourceExportState);
    const exportRunning = exportState?.status === 'decompiling' || exportState?.status === 'copying';
    const isOpen = progress !== null && !exportRunning;

    const percent = progress && progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    const handleCancel = () => {
        void cancelDecompile();
    };

    return (
        <Modal
            title={`Decompiling ${progress?.version ?? ""}...`}
            open={isOpen}
            closable={false}
            keyboard={false}
            mask={{ closable: false }}
            footer={
                <Flex justify="flex-end" gap={8}>
                    <Button danger onClick={handleCancel}>
                        Cancel
                    </Button>
                </Flex>
            }
            width={520}
        >
            <Flex vertical gap={12}>
                <Typography.Text type="secondary">
                    This happens only once per version. Cached for future use.
                </Typography.Text>
                <Progress
                    percent={percent}
                    format={() => `${progress?.current ?? 0} / ${progress?.total ?? 0}`}
                    status="active"
                />
                <Typography.Text
                    type="secondary"
                    style={{
                        fontSize: 12,
                        fontFamily: "monospace",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "block",
                    }}
                >
                    {progress?.className || "Starting..."}
                </Typography.Text>
                {(progress?.errors ?? 0) > 0 && (
                    <Typography.Text type="warning" style={{ fontSize: 12 }}>
                        ⚠️ {progress!.errors} error(s)
                    </Typography.Text>
                )}
            </Flex>
        </Modal>
    );
};