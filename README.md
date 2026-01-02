# dynamis-action

Publish a new version of a Dalamud plugin to Dynamis.

This action automatically parses the plugin manifest JSON from your ZIP file, extracting version number, game version, Dalamud API level, and changelog - just like the Dynamis web upload. You can also manually override any of these values.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `plugin_id` | Yes | | Your plugin ID in Dynamis |
| `internal_name` | Yes | | The internal name of your plugin (matches `{name}.json` in the ZIP) |
| `path` | Yes | | Path to the plugin ZIP file |
| `type` | No | `testing` | Release type: `testing` or `latest` |
| `version_number` | No | *from manifest* | Override version number |
| `game_version` | No | *from manifest* | Override game version |
| `dalamud_version` | No | *from manifest* | Override Dalamud API level |
| `changelog` | No | *from manifest* | Override changelog |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PUBLISHER_KEY` | Yes | Your Dynamis publisher key (store as a GitHub secret) |

## How It Works

The action reads your plugin ZIP and extracts metadata from `{internal_name}.json`:

- `AssemblyVersion` → Version number
- `ApplicableVersion` → Game version (defaults to `any`)
- `DalamudApiLevel` → Dalamud version (defaults to `9`)
- `Changelog` → Changelog text (defaults to empty)

If you provide manual inputs, they take priority over the manifest values.

## Example Workflows

### Simple (auto-parse from manifest)

```yaml
- name: Publish to Dynamis
  uses: PunishXIV/dynamis-action@v2
  with:
    plugin_id: "123"
    internal_name: "YourPlugin"
    path: "YourPlugin/bin/Release/YourPlugin.zip"
    type: "testing"
  env:
    PUBLISHER_KEY: ${{ secrets.PUBLISHER_KEY }}
```

### With manual overrides

```yaml
- name: Publish to Dynamis
  uses: PunishXIV/dynamis-action@v2
  with:
    plugin_id: "123"
    internal_name: "YourPlugin"
    path: "YourPlugin/bin/Release/YourPlugin.zip"
    type: "testing"
    version_number: ${{ github.ref_name }}
    changelog: ${{ github.event.release.body }}
  env:
    PUBLISHER_KEY: ${{ secrets.PUBLISHER_KEY }}
```

### Full workflow example

```yaml
name: Publish to Dynamis

on:
  workflow_dispatch:

permissions:
  actions: write

jobs:
  Build:
    runs-on: ubuntu-latest
    env:
      DALAMUD_HOME: /tmp/dalamud
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4
        with:
          submodules: true

      - name: Set up .NET
        uses: actions/setup-dotnet@v3
        with:
          dotnet-version: 10.0.x

      - name: Download Dalamud Latest
        run: |
          wget https://goatcorp.github.io/dalamud-distrib/latest.zip -O ${{ env.DALAMUD_HOME }}.zip
          unzip ${{ env.DALAMUD_HOME }}.zip -d ${{ env.DALAMUD_HOME }}

      - name: Restore Project
        run: dotnet restore

      - name: Build Project
        run: dotnet build --configuration Release YourPlugin/YourPlugin.csproj

      - name: Create plugin zip
        run: |
          cd YourPlugin/bin/Release
          zip YourPlugin.zip YourPlugin.json YourPlugin.dll

      - name: Publish to Dynamis
        uses: PunishXIV/dynamis-action@v2
        with:
          plugin_id: "123"
          internal_name: "YourPlugin"
          path: "YourPlugin/bin/Release/YourPlugin.zip"
          type: "testing"
        env:
          PUBLISHER_KEY: ${{ secrets.PUBLISHER_KEY }}
```

## Setup

1. **Get your plugin ID** from your Dynamis dashboard (the number in the URL)

2. **Add your publisher key as a GitHub secret:**
   - Go to your repo → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `PUBLISHER_KEY`
   - Value: Your Dynamis publisher key

3. **Create the workflow file** at `.github/workflows/publish.yml`

4. **Trigger the workflow:**
   - Go to Actions → Select the workflow → Run workflow

## Release Types

- `testing` - Publishes to the testing channel (safe for testing)
- `latest` - Publishes to production (users will receive this version)

## Backward Compatibility

Existing workflows that manually specify `version_number`, `game_version`, `dalamud_version`, and `changelog` will continue to work. Manual values take priority over parsed manifest values.

## Troubleshooting

### "Missing path" error
The ZIP file wasn't found. Check that your build step creates the ZIP at the expected path.

### "Manifest file not found" error
The `{internal_name}.json` file wasn't found inside the ZIP. Make sure:
- The `internal_name` input matches your plugin's internal name exactly (case-sensitive)
- The JSON file is included in your ZIP

### Build output location
Different Dalamud SDK versions output to different paths. Add a debug step to find your files:
```yaml
- name: List build output
  run: find . -name "*.dll" -o -name "*.json" -o -name "*.zip" | grep -i release
```
