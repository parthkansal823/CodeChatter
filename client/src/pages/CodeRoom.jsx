import TopBar from "../components/TopBar";
import FileExplorer from "../components/FileExplorer";
import CodeEditor from "../components/CodeEditor";
import RightSidebar from "../components/RightSidebar";
import BottomPanel from "../components/BottomPanel";

export default function CodeRoom() {
  return (
    <div className="h-screen flex flex-col bg-[#0f0f0f] text-white">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <FileExplorer />
        <CodeEditor />
        <RightSidebar />
      </div>
      <BottomPanel />
    </div>
  );
}