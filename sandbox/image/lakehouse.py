"""
Spark for a room's notebooks and scripts, with Delta Lake switched on and set up for a sandbox:

    from lakehouse import session
    spark = session()

The heap fits the room's memory, nothing listens beyond this machine, and its tables stay in the room's home (~/lakehouse), so they
outlive the sandbox and big files don't sync into everyone's editor. Spark keeps its list of tables in memory, so tables already on
disk are listed again each time a session starts.
"""
import glob
import os

HOME = os.path.expanduser("~/lakehouse")
WAREHOUSE = os.path.join(HOME, "warehouse")
# Spark refuses a heap under 512 MB, and its JVM needs some more outside that.
LEAST_HEAP_MB = 512
LEAST_MEMORY_MB = 650
MOST_HEAP_MB = 8192


def memory_limit_mb():
    """What this sandbox may use, from its control group. None when there's no limit."""
    try:
        with open("/sys/fs/cgroup/memory.max", encoding="ascii") as file:
            text = file.read().strip()
        return None if text == "max" else int(text) // (1024 * 1024)
    except (OSError, ValueError):
        return None


def memory_used_mb():
    """What programs in this sandbox hold now. Not the whole of memory.current, which counts files the kernel can let go of."""
    try:
        with open("/sys/fs/cgroup/memory.stat", encoding="ascii") as file:
            for line in file:
                name, value = line.split()
                if name == "anon":
                    return int(value) // (1024 * 1024)
    except (OSError, ValueError):
        pass
    return 0


def heap_mb(limit, used=0):
    """About two thirds of what's free: the JVM needs room outside its heap, and Python and the kernel need some too. Without a limit, 2 GB."""
    if limit is None:
        return 2048
    return max(LEAST_HEAP_MB, min((limit - used) * 2 // 3, MOST_HEAP_MB))


def too_little_memory(limit, used):
    """Why Spark shouldn't start here, in words someone can act on. Starting anyway ends with the sandbox killing it, which looks like a notebook that's stuck."""
    if limit is None:
        return None
    if limit < LEAST_MEMORY_MB:
        return f"Spark needs at least {LEAST_MEMORY_MB} MB, and this room's sandbox has {limit} MB. SANDBOX_MEMORY_MB on the server sets that."
    free = limit - used
    if free < LEAST_MEMORY_MB:
        return f"Spark needs about {LEAST_MEMORY_MB} MB free, and this room's sandbox has {free} MB free of its {limit} MB. Another notebook's Spark may be holding it: shut down that notebook's kernel, then try again."
    return None


def tables_on_disk():
    """Tables with at least one version. A write that was killed before its first commit leaves a folder that isn't a table yet."""
    if not os.path.isdir(WAREHOUSE):
        return []
    return sorted(name for name in os.listdir(WAREHOUSE) if glob.glob(os.path.join(WAREHOUSE, glob.escape(name), "_delta_log", "*.json")))


def session(app="lakehouse"):
    """The room's Spark session, made the first time it's asked for. The first takes a while on one CPU."""
    from pyspark.sql import SparkSession

    # A session this program already has is using memory that's counted as taken, and needs no more.
    running = SparkSession.getActiveSession()
    if running is not None:
        return running
    limit = memory_limit_mb()
    used = memory_used_mb()
    problem = too_little_memory(limit, used)
    if problem:
        raise RuntimeError(problem)
    os.makedirs(WAREHOUSE, exist_ok=True)
    spark = (
        SparkSession.builder.appName(app)
        .master("local[*]")
        .config("spark.driver.memory", f"{heap_mb(limit, used)}m")
        .config("spark.driver.host", "127.0.0.1")
        .config("spark.driver.bindAddress", "127.0.0.1")
        .config("spark.ui.enabled", "false")
        # Its progress bars redraw with carriage returns, which a notebook's output keeps as a long line of noise.
        .config("spark.ui.showConsoleProgress", "false")
        .config("spark.sql.shuffle.partitions", "4")
        .config("spark.sql.warehouse.dir", WAREHOUSE)
        .config("spark.local.dir", "/tmp/spark")
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("ERROR")
    for name in tables_on_disk():
        location = os.path.join(WAREHOUSE, name)
        # One table in a bad way shouldn't stop Spark for the whole room: the Lakehouse tool shows what's wrong with it.
        try:
            spark.sql(f"CREATE TABLE IF NOT EXISTS `{name}` USING delta LOCATION '{location}'")
        except Exception as error:  # Spark's own errors have no common base here.
            print(f"Couldn't open the table {name}: {str(error)[:200]}")
    return spark
