# Catalog

The catalog contains only targets whose runtime and installed model artifacts
were inspected directly. A target pins the executable/plugin hashes and a
deterministic model-artifact tree digest. Environment-dependent acceleration is
recorded by the run and never inferred from the machine's GPU alone.

Adding a model that uses an existing adapter should require catalog data only.
Adding a new execution mechanism requires an adapter implementation and adapter
contract tests.

The artifact-tree digest is SHA-256 over sorted UTF-8 lines in the form
`<file sha256>  <path relative to model root>\n`. It identifies the exact local
model payload even when an upstream conversion repository does not expose its
revision through the application API.
