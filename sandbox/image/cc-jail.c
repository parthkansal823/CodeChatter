// cc-jail: runs a program confined to the workspace with Landlock (Linux 5.13+).
//
//   cc-jail program [args...]
//
// Terminals, Run and the judge start through this. The program and everything
// it starts can read and run the toolchain (/usr, /etc), read /proc and /sys,
// and change files only in /workspace, /tmp, the home tmpfs and /dev/shm.
// Listing / or reading /opt (the sync agent), /var, /root and the rest fails
// with "Permission denied", and a Landlock domain can't be left or loosened.
//
// The container stays the security boundary (no network, read-only root, no
// capabilities); this is the second layer. On a kernel without Landlock the
// program runs unconfined.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#define READ (LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR)
#define RUN LANDLOCK_ACCESS_FS_EXECUTE
#define CHANGE                                                                                      \
  (LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE | LANDLOCK_ACCESS_FS_REMOVE_DIR |  \
   LANDLOCK_ACCESS_FS_REMOVE_FILE | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG |    \
   LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_SYM |     \
   LANDLOCK_ACCESS_FS_REFER)

static void fail(const char *what) {
  fprintf(stderr, "cc-jail: %s: %s\n", what, strerror(errno));
  _exit(126);
}

static void allow(int ruleset, const char *path, __u64 access, __u64 handled) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) return; // not in this image
  struct landlock_path_beneath_attr rule = {.allowed_access = access & handled, .parent_fd = fd};
  if (syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0) != 0) fail(path);
  close(fd);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fputs("usage: cc-jail program [args...]\n", stderr);
    return 2;
  }

  long abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi >= 1) {
    // Rights this kernel knows. Without REFER (ABI 2) the kernel refuses every
    // move between folders, so it's only handled where it can also be granted.
    // Device ioctls (ABI 5) stay unhandled: terminals need them on their pty.
    __u64 handled = READ | RUN | CHANGE | LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_BLOCK;
    if (abi < 2) handled &= ~(__u64)LANDLOCK_ACCESS_FS_REFER;
    if (abi < 3) handled &= ~(__u64)LANDLOCK_ACCESS_FS_TRUNCATE;

    struct landlock_ruleset_attr attr = {.handled_access_fs = handled};
    int ruleset = syscall(SYS_landlock_create_ruleset, &attr, sizeof attr, 0);
    if (ruleset < 0) fail("creating the ruleset");

    // The toolchain. /bin, /lib and friends are links into /usr on Debian.
    const char *toolchain[] = {"/usr", "/bin", "/sbin", "/lib", "/lib64"};
    for (size_t i = 0; i < sizeof toolchain / sizeof *toolchain; i++) allow(ruleset, toolchain[i], READ | RUN, handled);
    allow(ruleset, "/etc", READ, handled);
    allow(ruleset, "/proc", READ, handled);
    allow(ruleset, "/sys", READ, handled);
    // Terminals open /dev/ptmx and /dev/pts/*; programs write to /dev/null.
    allow(ruleset, "/dev", READ | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE, handled);
    allow(ruleset, "/dev/shm", READ | CHANGE, handled);
    allow(ruleset, "/workspace", READ | RUN | CHANGE, handled);
    allow(ruleset, "/tmp", READ | RUN | CHANGE, handled);
    allow(ruleset, "/home/ccuser", READ | RUN | CHANGE, handled);

    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) fail("no_new_privs");
    if (syscall(SYS_landlock_restrict_self, ruleset, 0) != 0) fail("restricting");
    close(ruleset);
  }

  execvp(argv[1], argv + 1);
  fprintf(stderr, "cc-jail: %s: %s\n", argv[1], strerror(errno));
  return 127;
}
