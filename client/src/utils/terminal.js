const WINDOWS_PLATFORM_PATTERN = /win/i;

function getClientPlatform() {
  if (typeof navigator === "undefined") {
    return "";
  }

  return navigator.userAgentData?.platform || navigator.platform || "";
}

export function isWindowsClient() {
  return WINDOWS_PLATFORM_PATTERN.test(getClientPlatform());
}

export function getDefaultTerminalShell() {
  return isWindowsClient() ? "powershell" : "bash";
}

export function getTerminalShellOptions() {
  const windowsClient = isWindowsClient();

  return [
    {
      id: "powershell",
      label: "PowerShell",
      shortLabel: "PS",
      description: windowsClient
        ? "Recommended on Windows for the smoothest terminal support."
        : "Useful when your workspace host supports PowerShell.",
    },
    {
      id: "bash",
      label: windowsClient ? "Git Bash" : "Bash",
      shortLabel: "Bash",
      description: windowsClient
        ? "Great if Git Bash is installed on the host machine."
        : "Recommended on Linux and macOS style environments.",
    },
    {
      id: "cmd",
      label: "CMD",
      shortLabel: "CMD",
      description: "Fallback Windows shell with broad compatibility.",
    },
  ];
}
