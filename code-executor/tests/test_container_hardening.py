"""The container must stay locked down; the only writable location is the /workspace tmpfs, and temp/home point at it."""
import sys, os, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import types
try:
    import docker  # noqa: F401
except ImportError:  # the Docker SDK is not installed in every dev environment; only its import surface is needed
    _d = types.ModuleType("docker"); _e = types.ModuleType("docker.errors")
    class _DockerException(Exception): pass
    class _ImageNotFound(_DockerException): pass
    _e.ImageNotFound = _ImageNotFound; _e.DockerException = _DockerException; _d.errors = _e; _d.from_env = lambda **k: None
    sys.modules["docker"] = _d; sys.modules["docker.errors"] = _e
from app.services.docker_runner import DockerRunner


class _Containers:
    def __init__(self): self.kwargs = None
    def create(self, **kw): self.kwargs = kw; return object()


class _Client:
    def __init__(self): self.containers = _Containers()


class HardeningTest(unittest.TestCase):
    def setUp(self):
        r = DockerRunner(); self.client = _Client(); r._client = self.client
        r.create_workspace_container("gcc:13.2.0", 0.5, 256, 64, "64m"); self.kw = self.client.containers.kwargs

    def test_isolation_flags_unchanged(self):
        kw = self.kw
        self.assertTrue(kw["network_disabled"]); self.assertEqual(kw["network_mode"], "none")
        self.assertEqual(kw["cap_drop"], ["ALL"]); self.assertEqual(kw["security_opt"], ["no-new-privileges"])
        self.assertTrue(kw["read_only"]); self.assertEqual(kw["user"], "1000:1000")
        self.assertEqual(kw["pids_limit"], 64); self.assertEqual(kw["mem_limit"], "256m")
        self.assertNotIn("volumes", kw); self.assertNotIn("privileged", kw)

    def test_only_workspace_is_writable(self):
        self.assertEqual(list(self.kw["tmpfs"]), ["/workspace"])

    def test_every_sandbox_container_is_labelled(self):
        from app.services.docker_runner import SANDBOX_LABEL
        self.assertEqual(self.kw["labels"], {SANDBOX_LABEL: "1"})

    def test_tmp_and_home_use_workspace(self):
        self.assertEqual(self.kw["environment"], {"TMPDIR": "/workspace", "HOME": "/workspace"})

    def test_workspace_is_noexec_unless_the_language_runs_its_own_binary(self):
        self.assertNotIn("exec", self.kw["tmpfs"]["/workspace"].split(","))  # default: Docker's noexec stays in force
        r = DockerRunner(); c = _Client(); r._client = c
        r.create_workspace_container("gcc:13.2.0", 0.5, 256, 64, "64m", allow_exec=True)
        opts = c.containers.kwargs["tmpfs"]["/workspace"].split(",")
        self.assertIn("exec", opts); self.assertNotIn("suid", opts); self.assertNotIn("dev", opts)
        self.assertEqual(list(c.containers.kwargs["tmpfs"]), ["/workspace"])

    def test_service_requests_exec_only_for_cpp(self):
        from app.services import execution_service as es
        seen = {}
        class R:
            def create_workspace_container(self, *a, **k): seen[a[0]] = k.get("allow_exec"); raise RuntimeError("stop")
            def remove_container(self, c): pass
        es._runner = R()
        import types
        t = types.SimpleNamespace(input="", expectedOutput="", returnOutput=False)
        for lang in ("python", "javascript", "java", "cpp"):
            es.execute_submission(lang, "x", [t])
        self.assertEqual(seen, {"python:3.12.3-slim": False, "node:20.11.1-slim": False,
                                "eclipse-temurin:21.0.2_13-jdk-jammy": False, "gcc:13.2.0": True})

if __name__ == "__main__": unittest.main()
