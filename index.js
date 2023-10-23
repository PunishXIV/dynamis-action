import { getInput, setFailed } from '@actions/core';
import { readFile, stat } from 'fs/promises';
import axios from 'axios';

const getInputs = () => {
  const inputs = {
    pluginId: getInput('plugin_id'),
    internalName: getInput('internal_name'),
    versionNumber: getInput('version_number'),
    path: getInput('path'),
    type: getInput('type') || 'testing',
    gameVersion: getInput('game_version') || 'any',
    dalamudVersion: getInput('dalamud_version') || '9',
    changelog: getInput('changelog') || '',
  };

  if (!inputs.pluginId) throw new Error('Missing plugin ID');
  if (!inputs.internalName) throw new Error('Missing internal name');
  if (!inputs.versionNumber) throw new Error('Missing version number');
  if (!inputs.path) throw new Error('Missing path');

  if (!process.env.PUBLISHER_KEY) throw new Error('Missing publisher key');

  return inputs;
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
    throw new Error('Failed to fetch:', e.message);
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

  const apiUrl = `https://puni.sh/api/plugins/download/${inputs.pluginId}/${inputs.internalName}/versions/${inputs.type}?versionNum=${inputs.versionNumber}&publisherKey=${process.env.PUBLISHER_KEY}`;

  console.log('Trying to fetch presigned URL');
  const presignedUrl = await tryFetch('PUT', apiUrl);
  console.log('Got presigned URL');

  const fileInfo = await tryReadFileInfo(inputs.path);
  const fileData = await tryReadFileData(inputs.path);

  console.log('Trying to upload file to presigned URL');
  await tryUploadFile(presignedUrl, fileData, fileInfo.size);
  console.log('Uploaded file');

  console.log('Trying to publish new version');
  const versionId = await tryFetch(
    'POST',
    apiUrl,
    JSON.stringify({
      gameVersion: inputs.gameVersion,
      dalamudVersion: inputs.dalamudVersion,
      changelog: inputs.changelog,
    }),
  );
  console.log('Published new version with ID ', versionId);
};

run().catch((err) => {
  console.error(err);
  setFailed(err.message);
});
