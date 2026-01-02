import { getInput, setFailed } from '@actions/core';
import { readFile, stat } from 'fs/promises';
import axios from 'axios';
import JSZip from 'jszip';

const getInputs = () => {
  const inputs = {
    pluginId: getInput('plugin_id'),
    internalName: getInput('internal_name'),
    path: getInput('path'),
    type: getInput('type') || 'testing',
    // Optional manual overrides (for backward compatibility)
    versionNumber: getInput('version_number') || null,
    gameVersion: getInput('game_version') || null,
    dalamudVersion: getInput('dalamud_version') || null,
    changelog: getInput('changelog') || null,
  };

  if (!inputs.pluginId) throw new Error('Missing plugin ID');
  if (!inputs.internalName) throw new Error('Missing internal name');
  if (!inputs.path) throw new Error('Missing path');

  if (!process.env.PUBLISHER_KEY) throw new Error('Missing publisher key');

  return inputs;
};

/**
 * Dalamud plugin manifest structure
 * @typedef {Object} DalamudManifest
 * @property {string} AssemblyVersion - Plugin version (e.g. "1.0.0.0")
 * @property {string} [ApplicableVersion] - Game version (e.g. "any")
 * @property {number|string} [DalamudApiLevel] - Dalamud API level (e.g. 14)
 * @property {string} [Changelog] - Changelog text
 */

const parseManifest = async (fileData, internalName) => {
  const zip = await JSZip.loadAsync(fileData);
  const manifestFile = zip.files[`${internalName}.json`];

  if (!manifestFile) {
    throw new Error(`Manifest file "${internalName}.json" not found in zip`);
  }

  const manifestData = await manifestFile.async('string');
  /** @type {DalamudManifest} */
  const parsed = JSON.parse(manifestData);

  return {
    versionNumber: parsed.AssemblyVersion,
    gameVersion: parsed.ApplicableVersion || 'any',
    dalamudVersion: String(parsed.DalamudApiLevel || '9'),
    changelog: parsed.Changelog || '',
  };
};

const tryFetch = async (method, url, body) => {
  try {
    const resp = await fetch(url, { method, body });
    const text = await resp.text();
    if (resp.status >= 400) {
      throw new Error(text);
    }
    return text;
  } catch (e) {
    throw e;
  }
};

const tryUploadFile = async (url, file, size) =>
  new Promise((resolve, reject) => {
    axios
      .put(url, file, {
        onUploadProgress: (e) => {
          console.log(
            'Upload progress:',
            Math.round((e.loaded * 100) / (e.total ?? size)),
          );
        },
      })
      .then(() => {
        resolve(true);
      })
      .catch((e) => {
        reject(e);
      });
  });

const tryReadFileInfo = async (path) => {
  try {
    return await stat(path);
  } catch (e) {
    throw new Error('Failed to read file info:', e.message);
  }
};

const tryReadFileData = async (path) => {
  try {
    return await readFile(path);
  } catch (e) {
    throw new Error('Failed to read file data:', e.message);
  }
};

const run = async () => {
  const inputs = getInputs();

  const fileInfo = await tryReadFileInfo(inputs.path);
  const fileData = await tryReadFileData(inputs.path);

  let versionNumber, gameVersion, dalamudVersion, changelog;

  if (inputs.versionNumber) {
    // Manual version provided - use manual inputs with defaults, skip manifest parsing
    console.log('Using manual inputs (manifest parsing skipped)');
    versionNumber = inputs.versionNumber;
    gameVersion = inputs.gameVersion || 'any';
    dalamudVersion = inputs.dalamudVersion || '9';
    changelog = inputs.changelog || '';
  } else {
    // No manual version - parse manifest
    console.log('Parsing manifest from zip');
    const manifest = await parseManifest(fileData, inputs.internalName);
    console.log('Manifest parsed successfully');

    versionNumber = manifest.versionNumber;
    gameVersion = inputs.gameVersion || manifest.gameVersion;
    dalamudVersion = inputs.dalamudVersion || manifest.dalamudVersion;
    changelog = inputs.changelog !== null ? inputs.changelog : manifest.changelog;
  }

  if (!versionNumber) {
    throw new Error('Version number not found in manifest and not provided manually');
  }

  console.log(`Version: ${versionNumber} (${inputs.versionNumber ? 'manual' : 'from manifest'})`);
  console.log(`Game version: ${gameVersion} (${inputs.gameVersion ? 'manual' : 'from manifest'})`);
  console.log(`Dalamud version: ${dalamudVersion} (${inputs.dalamudVersion ? 'manual' : 'from manifest'})`);
  console.log(`Changelog: ${changelog ? 'provided' : 'empty'} (${inputs.changelog !== null ? 'manual' : 'from manifest'})`);

  const apiUrl = `https://puni.sh/api/plugins/download/${inputs.pluginId}/${inputs.internalName}/versions/${inputs.type}?versionNum=${versionNumber}&publisherKey=${process.env.PUBLISHER_KEY}`;

  console.log('Trying to fetch presigned URL');
  const presignedUrl = await tryFetch('PUT', apiUrl);
  console.log('Got presigned URL');

  console.log('Trying to upload file to presigned URL');
  await tryUploadFile(presignedUrl, fileData, fileInfo.size);
  console.log('Uploaded file');

  console.log('Trying to publish new version');
  const versionId = await tryFetch(
    'POST',
    apiUrl,
    JSON.stringify({
      gameVersion,
      dalamudVersion,
      changelog,
    }),
  );
  console.log('Published new version with ID ', versionId);
};

run().catch((err) => {
  console.error(err);
  setFailed(err.message);
});
