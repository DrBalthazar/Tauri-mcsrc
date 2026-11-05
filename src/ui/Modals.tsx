import JavadocModal from "../javadoc/JavadocModal";
import { ENABLE_JAVADOC_EDITOR } from "../javadoc/JavadocConfig";
import ProgressModal from "./ProgressModal";
import AboutModal from "./AboutModal";
import SettingsModal from "./SettingsModal";
import StructureModal from "./StructureModal";
import { JarDecompilerModal } from "./JarDecompilerModal";
import IndexProgressNotification from "./IndexProgressNotification";
import LauncherMetaModal from "./meta/LauncherMetaModal";
import { SourceExportModal } from "./SourceExportModal";
import { DecompileProgressModal } from "./DecompileProgressModal";

const Modals = () => {
    return (
        <>
            <IndexProgressNotification />
            <ProgressModal />
            {ENABLE_JAVADOC_EDITOR && <JavadocModal />}
            <AboutModal />
            <SettingsModal />
            <LauncherMetaModal />
            <StructureModal />
            <JarDecompilerModal />
            <SourceExportModal />
            <DecompileProgressModal />
        </>
    );
};

export default Modals;