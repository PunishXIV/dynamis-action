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
  };

  if (!inputs.pluginId) throw new Error('Missing plugin ID');
  if (!inputs.internalName) throw new Error('Missing internal name');
  if (!inputs.path) throw new Error('Missing path');

  if (!process.env.PUBLISHER_KEY) throw new Error('Missing publisher key');

  return inputs;
};

const parseManifest = async (fileData, internalName) => {
  const zip = await JSZip.loadAsync(fileData);
  const manifestFile = zip.files[`${internalName}.json`];

  if (!manifestFile) {
    throw new Error(`Manifest file "${internalName}.json" not found in zip`);
  }

  const manifestData = await manifestFile.async('string');
  const parsed = JSON.parse(manifestData);

  return {
    versionNumber: parsed.AssemblyVersion,
    gameVersion: parsed.ApplicableVersion || 'any',
    dalamudVersion: parsed.DalamudApiLevel || '9',
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

  console.log('Parsing manifest from zip');
  const manifest = await parseManifest(fileData, inputs.internalName);
  console.log(`Found version: ${manifest.versionNumber}`);

  const apiUrl = `https://puni.sh/api/plugins/download/${inputs.pluginId}/${inputs.internalName}/versions/${inputs.type}?versionNum=${manifest.versionNumber}&publisherKey=${process.env.PUBLISHER_KEY}`;

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
      gameVersion: manifest.gameVersion,
      dalamudVersion: manifest.dalamudVersion,
      changelog: manifest.changelog,
    }),
  );
  console.log('Published new version with ID ', versionId);
};

run().catch((err) => {
  console.error(err);
  setFailed(err.message);
});
