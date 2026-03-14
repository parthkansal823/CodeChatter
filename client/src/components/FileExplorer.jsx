import FileItem from "./FileItem";

export default function FileExplorer() {

  const files = [
    "main.cpp",
    "utils.js",
    "input.txt",
    "README.md"
  ];

  return (
    <div className="group bg-[#111] w-14 hover:w-56 transition-all duration-300 border-r border-zinc-800">

      <div className="p-3 text-sm font-semibold opacity-0 group-hover:opacity-100">
        Files
      </div>

      <div className="flex flex-col">

        {files.map((file) => (
          <FileItem key={file} name={file} />
        ))}

      </div>

    </div>
  );
}