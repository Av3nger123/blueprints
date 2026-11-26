# @your-npm-scope/blueprints-core

This is the shared library behind the [blueprints](https://github.com/Av3nger123/blueprints) CLI and MCP server. It can:

- load blueprints from a local checkout or a GitHub raw URL
- validate them against the spec and the JSON Schema
- read `registry.json`, search it, and resolve `depends_on`

```ts
import { DEFAULT_SOURCE, loadBlueprint, readRegistry, resolveSource, searchRegistry } from '@your-npm-scope/blueprints-core';

const source = resolveSource();                       // DEFAULT_SOURCE, or a URL or local path
const registry = await readRegistry(source);
const hit = searchRegistry(registry, 'login', 'fastapi')[0]!;
const bp = await loadBlueprint(source, hit.name, { stack: 'fastapi', registry });
bp.files['BLUEPRINT.md']; bp.files['adapters/fastapi.md']; bp.manifest.version;
```

Other exports:

- `validateBlueprintDir`
- `buildRegistry` and `serializeRegistry`
- `findEntry` and `resolveDependencies`
- `parseChecklist`
- `satisfies` (npm-style ranges)
- `renderSkill`

Runtime dependencies are `ajv` and `yaml`. MIT licensed.
