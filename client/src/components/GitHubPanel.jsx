import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpFromLine, BookMarked, BookOpen, Check, CheckCircle2,
  ChevronDown, CircleDot, Code2, ExternalLink, FileCode2,
  FolderOpen, Github, GitBranch, GitFork, Link2, Link2Off,
  Loader2, Lock, RefreshCw, Search, Share2, Star, Unlock,
  XCircle, X, Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { secureFetch } from "../utils/security";

// ── tiny helpers ────────────────────────────────────────────────────────────

function Pill({ children, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

function SectionHeader({ icon: Icon, title, action }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 dark:border-white/[0.05]">
      <div className="flex items-center gap-2">
        <Icon size={13} className="text-zinc-400 dark:text-zinc-500" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{title}</span>
      </div>
      {action}
    </div>
  );
}

const SYNC_DEBOUNCE_MS = 4000; // wait 4 s after workspace-saved before auto-syncing

// ── main component ──────────────────────────────────────────────────────────

export default function GitHubPanel({ roomId, activeFilePath, activeCode }) {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [view, setView] = useState("home"); // home | repos | gists | push | import
  const [profile, setProfile] = useState(null);
  const [repos, setRepos] = useState([]);
  const [gists, setGists] = useState([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [repoTree, setRepoTree] = useState(null);
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [importPath, setImportPath] = useState("");
  const [importLink, setImportLink] = useState(true); // checkbox: link on import
  const [pushRepo, setPushRepo] = useState(null);
  const [pushBranch, setPushBranch] = useState("main");
  const [pushCommitMsg, setPushCommitMsg] = useState("");
  const [gistDesc, setGistDesc] = useState("");
  const [gistPublic, setGistPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState("");
  const [pushed, setPushed] = useState(false);
  const [gisted, setGisted] = useState(null);

  // ── linked repo state ──────────────────────────────────────────────────────
  const [linkedRepo, setLinkedRepo] = useState(null);   // null | { owner, repo, branch, folderId, folderName }
  const [linkedLoading, setLinkedLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | error
  const [lastSynced, setLastSynced] = useState(null);
  const [syncResult, setSyncResult] = useState(null);   // { pushed, unchanged, errors }
  const [autoSync, setAutoSync] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`cc-autosync-${roomId}`) || "false"); }
    catch { return false; }
  });

  const syncTimerRef = useRef(null);

  const isConnected = Boolean(user?.githubConnected);

  const apiFetch = useCallback(
    (url, opts = {}) => secureFetch(url, opts, token),
    [token],
  );

  // ── fetch linked repo on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || !roomId) { setLinkedLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const link = await apiFetch(API_ENDPOINTS.GITHUB_ROOM_LINK(roomId));
        if (alive) setLinkedRepo(link?.owner ? link : null);
      } catch {
        if (alive) setLinkedRepo(null);
      } finally {
        if (alive) setLinkedLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [isConnected, roomId, apiFetch]);

  // ── persist autoSync preference ───────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(`cc-autosync-${roomId}`, JSON.stringify(autoSync)); } catch { /* */ }
  }, [autoSync, roomId]);

  // ── auto-sync on workspace-saved ─────────────────────────────────────────
  const triggerSync = useCallback(async (silent = false) => {
    if (!linkedRepo || syncStatus === "syncing") return;
    setSyncStatus("syncing");
    try {
      const result = await apiFetch(API_ENDPOINTS.GITHUB_ROOM_SYNC(roomId), { method: "POST" });
      setSyncResult(result);
      setSyncStatus("synced");
      setLastSynced(new Date());
      if (!silent && result.pushed > 0) {
        toast.success(`Synced ${result.pushed} file${result.pushed !== 1 ? "s" : ""} → GitHub`);
      }
      if (result.errors?.length) {
        toast.error(`${result.errors.length} file(s) failed to sync`);
      }
    } catch (e) {
      setSyncStatus("error");
      if (!silent) toast.error(e.message || "Sync failed");
    }
  }, [linkedRepo, syncStatus, apiFetch, roomId]);

  useEffect(() => {
    if (!autoSync || !linkedRepo) return;

    const handleSaved = () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => triggerSync(true), SYNC_DEBOUNCE_MS);
    };

    window.addEventListener("cc-workspace-saved", handleSaved);
    return () => {
      window.removeEventListener("cc-workspace-saved", handleSaved);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [autoSync, linkedRepo, triggerSync]);

  // ── load profile + repos ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || view !== "home") return;
    let alive = true;
    (async () => {
      try {
        const [prof, repoList] = await Promise.all([
          apiFetch(API_ENDPOINTS.GITHUB_PROFILE),
          apiFetch(API_ENDPOINTS.GITHUB_REPOS),
        ]);
        if (!alive) return;
        setProfile(prof);
        setRepos(repoList);
      } catch (e) {
        if (alive) toast.error(e.message || "Failed to load GitHub data");
      }
    })();
    return () => { alive = false; };
  }, [isConnected, view, apiFetch]);

  // ── load gists ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || view !== "gists") return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await apiFetch(API_ENDPOINTS.GITHUB_GISTS);
        if (alive) setGists(data);
      } catch (e) {
        if (alive) toast.error(e.message || "Failed to load gists");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [isConnected, view, apiFetch]);

  // ── connect GitHub ────────────────────────────────────────────────────────
  const connectGitHub = () => {
    const connectUrl = API_ENDPOINTS.GITHUB_CONNECT(token);
    const cb = `${window.location.origin}/auth/callback`;
    window.location.href = `${connectUrl}&redirect_uri=${encodeURIComponent(cb)}`;
  };

  // ── repo tree ─────────────────────────────────────────────────────────────
  const loadRepoTree = async (repo, branch = "") => {
    setLoading(true);
    setLoadingAction("tree");
    try {
      const [treeData, branchList] = await Promise.all([
        apiFetch(`${API_ENDPOINTS.GITHUB_REPO_TREE(repo.owner, repo.name)}${branch ? `?branch=${branch}` : ""}`),
        apiFetch(API_ENDPOINTS.GITHUB_REPO_BRANCHES(repo.owner, repo.name)),
      ]);
      setRepoTree(treeData);
      setBranches(branchList);
      setSelectedBranch(treeData.branch);
    } catch (e) {
      toast.error(e.message || "Failed to load repo");
    } finally {
      setLoading(false);
      setLoadingAction("");
    }
  };

  // ── import ────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!selectedRepo || !roomId) return;
    setLoading(true);
    setLoadingAction("import");
    try {
      const result = await apiFetch(API_ENDPOINTS.GITHUB_IMPORT(roomId), {
        method: "POST",
        body: JSON.stringify({
          owner: selectedRepo.owner,
          repo: selectedRepo.name,
          branch: selectedBranch,
          path: importPath,
          roomId,
          link: importLink,
        }),
      });
      toast.success(`Imported ${result.imported} file${result.imported !== 1 ? "s" : ""} from ${result.repoFolder}`);
      if (result.linked) {
        setLinkedRepo({ owner: selectedRepo.owner, repo: selectedRepo.name, branch: result.branch, folderId: result.folderId, folderName: result.repoFolder });
        toast.success(`Linked to ${selectedRepo.fullName} for auto-sync`);
      }
      setView("home");
      window.dispatchEvent(new CustomEvent("cc-workspace-reload"));
    } catch (e) {
      toast.error(e.message || "Import failed");
    } finally {
      setLoading(false);
      setLoadingAction("");
    }
  };

  // ── push single file ──────────────────────────────────────────────────────
  const handlePush = async () => {
    if (!pushRepo || !activeFilePath || !activeCode) return;
    setLoading(true);
    setLoadingAction("push");
    try {
      const result = await apiFetch(API_ENDPOINTS.GITHUB_PUSH, {
        method: "POST",
        body: JSON.stringify({
          owner: pushRepo.owner,
          repo: pushRepo.name,
          branch: pushBranch || pushRepo.defaultBranch,
          filePath: activeFilePath,
          content: activeCode,
          commitMessage: pushCommitMsg || `Update ${activeFilePath} via CodeChatter`,
        }),
      });
      setPushed(true);
      toast.success(`${result.action === "created" ? "Created" : "Updated"} ${activeFilePath} in ${pushRepo.fullName}`);
      setTimeout(() => setPushed(false), 3000);
    } catch (e) {
      toast.error(e.message || "Push failed");
    } finally {
      setLoading(false);
      setLoadingAction("");
    }
  };

  // ── create gist ───────────────────────────────────────────────────────────
  const handleCreateGist = async () => {
    if (!activeCode || !activeFilePath) return;
    setLoading(true);
    setLoadingAction("gist");
    try {
      const filename = activeFilePath.split("/").pop() || "snippet.txt";
      const result = await apiFetch(API_ENDPOINTS.GITHUB_CREATE_GIST, {
        method: "POST",
        body: JSON.stringify({
          description: gistDesc || `Shared from CodeChatter — ${filename}`,
          filename,
          content: activeCode,
          public: gistPublic,
        }),
      });
      setGisted(result.htmlUrl);
      toast.success("Gist created!");
    } catch (e) {
      toast.error(e.message || "Failed to create gist");
    } finally {
      setLoading(false);
      setLoadingAction("");
    }
  };

  // ── unlink ────────────────────────────────────────────────────────────────
  const handleUnlink = async () => {
    try {
      await apiFetch(API_ENDPOINTS.GITHUB_ROOM_LINK(roomId), { method: "DELETE" });
      setLinkedRepo(null);
      setSyncStatus("idle");
      setSyncResult(null);
      setAutoSync(false);
      toast.success("Unlinked from GitHub repo");
    } catch (e) {
      toast.error(e.message || "Failed to unlink");
    }
  };

  // ── filtered repos ────────────────────────────────────────────────────────
  const filteredRepos = repos.filter((r) =>
    r.fullName.toLowerCase().includes(repoSearch.toLowerCase()),
  );

  // ── not connected ─────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 px-6 py-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900">
          <Github size={28} className="text-zinc-600 dark:text-zinc-400" />
        </div>
        <div>
          <p className="font-semibold text-zinc-900 dark:text-white">Connect GitHub</p>
          <p className="mt-1 text-xs text-zinc-500">
            Link your GitHub account to import repos, push files, and create gists right from the editor.
          </p>
        </div>
        <button
          onClick={connectGitHub}
          className="flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <Github size={15} />
          Connect GitHub
        </button>
        <button
          onClick={() => navigate("/settings")}
          className="text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Manage in Settings
        </button>
      </div>
    );
  }

  // ── repo picker (shared) ──────────────────────────────────────────────────
  const RepoPicker = ({ onSelect, selectedId }) => (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          value={repoSearch}
          onChange={(e) => setRepoSearch(e.target.value)}
          placeholder="Search repos…"
          className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-3 text-xs placeholder-zinc-400 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        />
      </div>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {filteredRepos.length === 0 && (
          <p className="py-4 text-center text-xs text-zinc-400">No repos found</p>
        )}
        {filteredRepos.map((r) => (
          <button
            key={r.id}
            onClick={() => onSelect(r)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition ${
              selectedId === r.id
                ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                : "hover:bg-zinc-100 dark:hover:bg-white/[0.05] text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {r.private ? <Lock size={11} className="shrink-0 text-zinc-400" /> : <Unlock size={11} className="shrink-0 text-zinc-400" />}
            <span className="min-w-0 flex-1 truncate font-medium">{r.fullName}</span>
            {r.language && <Pill className="bg-zinc-100 text-zinc-500 dark:bg-zinc-800">{r.language}</Pill>}
          </button>
        ))}
      </div>
    </div>
  );

  // ── import view ───────────────────────────────────────────────────────────
  if (view === "import") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-white/[0.05]">
          <button onClick={() => { setView("home"); setSelectedRepo(null); setRepoTree(null); }} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            <X size={14} />
          </button>
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Import from GitHub</span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-4 p-4">
          {!selectedRepo ? (
            <>
              <p className="text-xs text-zinc-500">Select a repo to import files from.</p>
              <RepoPicker
                onSelect={async (r) => { setSelectedRepo(r); await loadRepoTree(r); }}
                selectedId={selectedRepo?.id}
              />
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                <BookOpen size={13} className="text-violet-500" />
                <span className="flex-1 truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{selectedRepo.fullName}</span>
                <button onClick={() => { setSelectedRepo(null); setRepoTree(null); }} className="text-zinc-400 hover:text-zinc-600">
                  <X size={12} />
                </button>
              </div>

              {loading && loadingAction === "tree" ? (
                <div className="flex items-center gap-2 py-4 text-xs text-zinc-400">
                  <Loader2 size={13} className="animate-spin" /> Loading tree…
                </div>
              ) : repoTree && (
                <>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Branch</label>
                    <select
                      value={selectedBranch}
                      onChange={(e) => { setSelectedBranch(e.target.value); loadRepoTree(selectedRepo, e.target.value); }}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                    >
                      {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Subfolder (optional)</label>
                    <input
                      value={importPath}
                      onChange={(e) => setImportPath(e.target.value)}
                      placeholder="e.g. src/components"
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs placeholder-zinc-400 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                    />
                  </div>

                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      {repoTree.files.length} files{repoTree.truncated ? " (truncated)" : ""}
                    </p>
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
                      {repoTree.files.slice(0, 50).map((f) => (
                        <div key={f.path} className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1 last:border-0 dark:border-zinc-800">
                          {f.type === "file" ? <FileCode2 size={10} className="shrink-0 text-zinc-400" /> : <FolderOpen size={10} className="shrink-0 text-amber-400" />}
                          <span className="truncate text-[11px] text-zinc-600 dark:text-zinc-400">{f.path}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Link-for-sync checkbox */}
                  <label className="flex items-center gap-2.5 cursor-pointer rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-500/20 dark:bg-emerald-500/[0.07]">
                    <input
                      type="checkbox"
                      checked={importLink}
                      onChange={(e) => setImportLink(e.target.checked)}
                      className="accent-emerald-500"
                    />
                    <div>
                      <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Enable auto-sync</p>
                      <p className="text-[10px] text-emerald-700/70 dark:text-emerald-400/70">
                        Link this repo so changes sync back to GitHub automatically
                      </p>
                    </div>
                  </label>

                  <button
                    onClick={handleImport}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
                  >
                    {loading && loadingAction === "import" ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpFromLine size={14} />}
                    Import into room
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── push view ─────────────────────────────────────────────────────────────
  if (view === "push") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-white/[0.05]">
          <button onClick={() => { setView("home"); setPushRepo(null); setPushed(false); }} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            <X size={14} />
          </button>
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Push to GitHub</span>
        </div>
        <div className="flex-1 overflow-y-auto space-y-4 p-4">
          {!activeFilePath ? (
            <p className="text-xs text-zinc-400">Open a file in the editor first.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                <FileCode2 size={12} className="text-violet-500" />
                <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">{activeFilePath}</span>
              </div>

              <RepoPicker
                onSelect={(r) => { setPushRepo(r); setPushBranch(r.defaultBranch || "main"); }}
                selectedId={pushRepo?.id}
              />

              {pushRepo && (
                <>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Branch</label>
                    <input
                      value={pushBranch}
                      onChange={(e) => setPushBranch(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Commit message</label>
                    <input
                      value={pushCommitMsg}
                      onChange={(e) => setPushCommitMsg(e.target.value)}
                      placeholder={`Update ${activeFilePath} via CodeChatter`}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs placeholder-zinc-400 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                    />
                  </div>
                  <button
                    onClick={handlePush}
                    disabled={loading || pushed}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {loading && loadingAction === "push" ? <Loader2 size={14} className="animate-spin" /> : pushed ? <Check size={14} /> : <ArrowUpFromLine size={14} />}
                    {pushed ? "Pushed!" : `Push to ${pushRepo.name}`}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── gists view ────────────────────────────────────────────────────────────
  if (view === "gists") {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-white/[0.05]">
          <button onClick={() => setView("home")} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            <X size={14} />
          </button>
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Gists</span>
        </div>

        {activeFilePath && activeCode && (
          <div className="border-b border-zinc-100 p-4 dark:border-white/[0.05] space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Share current file as Gist</p>
            <input
              value={gistDesc}
              onChange={(e) => setGistDesc(e.target.value)}
              placeholder="Description (optional)"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs placeholder-zinc-400 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={gistPublic} onChange={(e) => setGistPublic(e.target.checked)} className="accent-violet-600" />
                Make public
              </label>
              {gisted && (
                <a href={gisted} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-violet-600 hover:underline dark:text-violet-400">
                  <ExternalLink size={11} /> View gist
                </a>
              )}
              <button
                onClick={handleCreateGist}
                disabled={loading}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
              >
                {loading && loadingAction === "gist" ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                Create Gist
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && gists.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-zinc-400" />
            </div>
          ) : gists.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-400">No gists yet.</p>
          ) : (
            gists.map((g) => (
              <a
                key={g.id}
                href={g.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 border-b border-zinc-100 px-4 py-3 hover:bg-zinc-50 dark:border-white/[0.04] dark:hover:bg-white/[0.03]"
              >
                <Code2 size={13} className="mt-0.5 shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{g.files[0] || "Untitled"}</p>
                  {g.description && <p className="mt-0.5 truncate text-[11px] text-zinc-500">{g.description}</p>}
                </div>
                <Pill className={g.public ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}>
                  {g.public ? <Unlock size={9} /> : <Lock size={9} />}
                  {g.public ? "Public" : "Secret"}
                </Pill>
              </a>
            ))
          )}
        </div>
      </div>
    );
  }

  // ── home view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Profile card */}
      <div className="border-b border-zinc-100 p-4 dark:border-white/[0.05]">
        {profile ? (
          <div className="flex items-center gap-3">
            <img src={profile.avatarUrl} alt={profile.login} className="h-10 w-10 rounded-full ring-2 ring-zinc-200 dark:ring-zinc-700" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{profile.name || profile.login}</p>
                <a href={profile.htmlUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={11} className="text-zinc-400 hover:text-zinc-600" />
                </a>
              </div>
              <p className="truncate text-xs text-zinc-500">@{profile.login}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{profile.publicRepos}</p>
              <p className="text-[10px] text-zinc-500">repos</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-zinc-200 animate-pulse dark:bg-zinc-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 rounded bg-zinc-200 animate-pulse dark:bg-zinc-800" />
              <div className="h-2.5 w-16 rounded bg-zinc-200 animate-pulse dark:bg-zinc-800" />
            </div>
          </div>
        )}
      </div>

      {/* ── Linked repo sync card ─────────────────────────────────────────── */}
      {!linkedLoading && (
        linkedRepo ? (
          <div className="border-b border-zinc-100 dark:border-white/[0.05] p-4 space-y-3">
            {/* Header row */}
            <div className="flex items-center gap-2">
              <Link2 size={13} className="text-emerald-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                  {linkedRepo.owner}/{linkedRepo.repo}
                </p>
                <p className="text-[10px] text-zinc-400 flex items-center gap-1">
                  <GitBranch size={9} /> {linkedRepo.branch} · {linkedRepo.folderName}/
                </p>
              </div>
              <button
                onClick={handleUnlink}
                title="Unlink repo"
                className="text-zinc-400 hover:text-rose-500 transition"
              >
                <Link2Off size={13} />
              </button>
            </div>

            {/* Sync status row */}
            <div className="flex items-center gap-2">
              {syncStatus === "syncing" && <Loader2 size={12} className="animate-spin text-violet-500" />}
              {syncStatus === "synced" && <CheckCircle2 size={12} className="text-emerald-500" />}
              {syncStatus === "error" && <XCircle size={12} className="text-rose-500" />}
              {syncStatus === "idle" && <CircleDot size={12} className="text-zinc-400" />}
              <span className="text-[11px] text-zinc-500 flex-1">
                {syncStatus === "syncing" && "Syncing…"}
                {syncStatus === "synced" && syncResult && `${syncResult.pushed} pushed · ${syncResult.unchanged} unchanged`}
                {syncStatus === "synced" && !syncResult && "Up to date"}
                {syncStatus === "error" && "Sync failed"}
                {syncStatus === "idle" && (lastSynced ? `Last synced ${lastSynced.toLocaleTimeString()}` : "Not synced yet")}
              </span>
              <button
                onClick={() => triggerSync(false)}
                disabled={syncStatus === "syncing"}
                title="Sync now"
                className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
              >
                <RefreshCw size={11} className={syncStatus === "syncing" ? "animate-spin" : ""} />
                Sync
              </button>
            </div>

            {/* Auto-sync toggle */}
            <label className="flex items-center justify-between cursor-pointer select-none">
              <div className="flex items-center gap-2">
                <Zap size={12} className={autoSync ? "text-amber-400" : "text-zinc-400"} />
                <span className="text-xs text-zinc-600 dark:text-zinc-400">Auto-sync on save</span>
              </div>
              <button
                onClick={() => setAutoSync((v) => !v)}
                className={`relative h-5 w-9 rounded-full transition-colors ${autoSync ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${autoSync ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </label>

            {syncResult?.errors?.length > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 dark:border-rose-500/20 dark:bg-rose-500/[0.07]">
                <p className="text-[10px] font-semibold text-rose-700 dark:text-rose-400 mb-1">Sync errors</p>
                {syncResult.errors.slice(0, 3).map((e, i) => (
                  <p key={i} className="text-[10px] text-rose-600 dark:text-rose-400 truncate">{e}</p>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* No linked repo — small hint */
          <div className="border-b border-zinc-100 dark:border-white/[0.05] px-4 py-3 flex items-center gap-2">
            <Link2Off size={12} className="text-zinc-400 shrink-0" />
            <p className="text-[11px] text-zinc-400">No repo linked. Import a repo with auto-sync enabled.</p>
          </div>
        )
      )}

      {/* Action cards */}
      <div className="grid grid-cols-2 gap-3 p-4">
        {[
          { id: "import", icon: ArrowUpFromLine, label: "Import Repo",  desc: "Pull files into workspace", color: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-500/10" },
          { id: "push",   icon: GitBranch,       label: "Push File",    desc: "Commit active file",        color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
          { id: "gists",  icon: BookMarked,       label: "Gists",        desc: "Create & view gists",       color: "text-amber-500",   bg: "bg-amber-50 dark:bg-amber-500/10"   },
          { id: "repos",  icon: BookOpen,         label: "Repos",        desc: "Browse your repos",         color: "text-sky-500",     bg: "bg-sky-50 dark:bg-sky-500/10"       },
        ].map(({ id, icon: Icon, label, desc, color, bg }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className="flex flex-col items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-left transition hover:border-zinc-300 hover:shadow-sm dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.12]"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${bg}`}>
              <Icon size={15} className={color} />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{label}</p>
              <p className="text-[10px] text-zinc-500">{desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Recent repos */}
      {repos.length > 0 && (
        <div>
          <SectionHeader icon={BookOpen} title="Recent Repos" action={
            <button onClick={() => setView("repos")} className="text-[10px] text-violet-500 hover:underline">See all</button>
          } />
          <div className="divide-y divide-zinc-100 dark:divide-white/[0.04]">
            {repos.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                {r.private ? <Lock size={11} className="shrink-0 text-zinc-400" /> : <GitFork size={11} className="shrink-0 text-zinc-400" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{r.name}</p>
                  {r.language && <p className="text-[10px] text-zinc-500">{r.language}</p>}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <Star size={9} /> {r.stargazersCount}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
