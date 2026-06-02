const STORAGE_KEY = "fieldExplorerRecords";
const DB_NAME = "fieldExplorerDb";
const STORE_NAME = "appData";
const RECORDS_DB_KEY = "records";

const form = document.querySelector("#recordForm");
const recordList = document.querySelector("#recordList");
const recordCount = document.querySelector("#recordCount");
const clearRecordsButton = document.querySelector("#clearRecords");
const photoLibraryInput = document.querySelector("#photoLibrary");
const photoCameraInput = document.querySelector("#photoCamera");
const photoFileInput = document.querySelector("#photoFile");
const photoPreview = document.querySelector("#photoPreview");
const clearPhotosButton = document.querySelector("#clearPhotos");
const chooseLibraryButton = document.querySelector("#chooseLibrary");
const chooseCameraButton = document.querySelector("#chooseCamera");
const chooseFileButton = document.querySelector("#chooseFile");
const voiceTitleButton = document.querySelector("#voiceTitleButton");
const voiceDescriptionButton = document.querySelector("#voiceDescriptionButton");
const startRecordingButton = document.querySelector("#startRecording");
const stopRecordingButton = document.querySelector("#stopRecording");
const recordingStatus = document.querySelector("#recordingStatus");
const recordedAudio = document.querySelector("#recordedAudio");
const audioTranscript = document.querySelector("#audioTranscript");
const getLocationButton = document.querySelector("#getLocation");
const saveStatus = document.querySelector("#saveStatus");

const MAX_PHOTOS = 4;
const MAX_IMAGE_SIZE = 720;
const IMAGE_QUALITY = 0.58;
const MAX_AUDIO_SAVE_LENGTH = 900_000;

let records = [];
let selectedPhotos = [];
let mediaRecorder = null;
let recordedChunks = [];
let recordedAudioDataUrl = "";
let recordingRecognition = null;
let recordingTranscriptParts = [];
let editingRecordId = null;

initializeApp();
setupVoiceTitle();
setupVoiceDescription();

chooseLibraryButton.addEventListener("click", () => photoLibraryInput.click());
chooseCameraButton.addEventListener("click", () => photoCameraInput.click());
chooseFileButton.addEventListener("click", () => photoFileInput.click());

[photoLibraryInput, photoCameraInput, photoFileInput].forEach((input) => {
  input.addEventListener("change", () => handlePhotoSelection(input));
});

async function handlePhotoSelection(input) {
  setSaveStatus("");
  const remainingSlots = MAX_PHOTOS - selectedPhotos.length;

  if (remainingSlots <= 0) {
    setSaveStatus(`사진은 테스트 버전에서 최대 ${MAX_PHOTOS}장까지 저장합니다.`, true);
    input.value = "";
    return;
  }

  const files = Array.from(input.files).slice(0, remainingSlots);

  if (input.files.length > remainingSlots) {
    setSaveStatus(`사진은 테스트 버전에서 최대 ${MAX_PHOTOS}장까지 저장합니다.`, true);
  }

  const newPhotos = await Promise.all(files.map(readPhotoFile));
  selectedPhotos = selectedPhotos.concat(newPhotos);
  input.value = "";
  renderPhotoPreview();
}

clearPhotosButton.addEventListener("click", () => {
  selectedPhotos = [];
  photoLibraryInput.value = "";
  photoCameraInput.value = "";
  photoFileInput.value = "";
  renderPhotoPreview();
  setSaveStatus("첨부한 사진을 비웠습니다.");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const audioFile = formData.get("audio");
  const transcript = formData.get("audioTranscript").trim();

  const newRecord = {
    id: editingRecordId || createId(),
    title: formData.get("title").trim(),
    photos: selectedPhotos,
    photoName: selectedPhotos[0]?.name || "",
    photoDataUrl: selectedPhotos[0]?.dataUrl || "",
    audioName: recordedAudioDataUrl ? "직접 녹음한 음성메모" : audioFile?.name || "",
    audioDataUrl: getStorableAudioDataUrl(),
    audioTranscript: transcript,
    audioSummary: summarizeTranscript(transcript),
    location: formData.get("location").trim(),
    description: formData.get("description").trim(),
    tags: parseTags(formData.get("tags")),
    createdAt: new Date().toLocaleString("ko-KR"),
  };

  try {
    if (editingRecordId) {
      records = records.map((record) => (record.id === editingRecordId ? newRecord : record));
    } else {
      records.unshift(newRecord);
    }
    await saveRecords();
    setSaveStatus(editingRecordId ? "수정되었습니다." : "저장되었습니다. 아래 기록 목록에서 확인할 수 있습니다.");
  } catch (error) {
    if (!editingRecordId) {
      records.shift();
    }
    setSaveStatus(
      "저장 공간이 부족합니다. 사진을 1~2장으로 줄이거나 녹음 재생 저장 없이 다시 시도해주세요.",
      true,
    );
    console.error(error);
    return;
  }

  renderRecords();
  resetForm();
});

clearRecordsButton.addEventListener("click", async () => {
  if (records.length === 0) {
    return;
  }

  const shouldClear = confirm("저장된 모든 기록을 삭제할까요?");

  if (!shouldClear) {
    return;
  }

  records = [];
  await saveRecords();
  renderRecords();
});

recordList.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-id]");

  if (!editButton) {
    return;
  }

  const record = records.find((item) => item.id === editButton.dataset.editId);

  if (!record) {
    return;
  }

  startEditRecord(record);
});

startRecordingButton.addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    recordingStatus.textContent = "이 브라우저에서는 바로 녹음을 지원하지 않습니다.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", async () => {
      const audioBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      recordedAudioDataUrl = await readBlobAsDataUrl(audioBlob);
      recordedAudio.src = recordedAudioDataUrl;
      recordedAudio.hidden = false;
      recordingStatus.textContent = "녹음이 저장되었습니다. 저장 버튼을 누르면 기록에 포함됩니다.";
      stream.getTracks().forEach((track) => track.stop());
      stopRecordingTranscription();
    });

    mediaRecorder.start();
    startRecordingTranscription();
    startRecordingButton.disabled = true;
    stopRecordingButton.disabled = false;
    recordingStatus.textContent = "녹음 중입니다.";
  } catch {
    recordingStatus.textContent = "마이크 권한이 필요합니다. 브라우저 권한을 허용해주세요.";
  }
});

stopRecordingButton.addEventListener("click", () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    return;
  }

  mediaRecorder.stop();
  stopRecordingTranscription();
  startRecordingButton.disabled = false;
  stopRecordingButton.disabled = true;
});

getLocationButton.addEventListener("click", async () => {
  const locationInput = document.querySelector("#location");

  if (!navigator.geolocation) {
    locationInput.value = "이 브라우저에서는 위치 가져오기를 지원하지 않습니다.";
    return;
  }

  getLocationButton.disabled = true;
  getLocationButton.textContent = "확인 중";

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const latitude = position.coords.latitude.toFixed(6);
      const longitude = position.coords.longitude.toFixed(6);
      locationInput.value = `위도 ${latitude}, 경도 ${longitude}`;
      locationInput.value = await getAddressFromCoordinates(latitude, longitude);
      getLocationButton.disabled = false;
      getLocationButton.textContent = "현재 위치";
    },
    () => {
      locationInput.value = "위치 권한이 필요합니다.";
      getLocationButton.disabled = false;
      getLocationButton.textContent = "현재 위치";
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    },
  );
});

function setupVoiceTitle() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    voiceTitleButton.textContent = "키보드 마이크";
    voiceTitleButton.addEventListener("click", focusTitleForKeyboardDictation);
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceTitleButton.addEventListener("click", () => {
    voiceTitleButton.disabled = true;
    voiceTitleButton.textContent = "듣는 중";
    recognition.start();
  });

  recognition.addEventListener("result", (event) => {
    const titleInput = document.querySelector("#title");
    titleInput.value = event.results[0][0].transcript.trim();
  });

  recognition.addEventListener("end", () => {
    voiceTitleButton.disabled = false;
    voiceTitleButton.textContent = "음성 입력";
  });

  recognition.addEventListener("error", () => {
    voiceTitleButton.disabled = false;
    voiceTitleButton.textContent = "키보드 마이크";
    focusTitleForKeyboardDictation();
  });
}

function setupVoiceDescription() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    voiceDescriptionButton.textContent = "키보드 마이크";
    voiceDescriptionButton.addEventListener("click", focusDescriptionForKeyboardDictation);
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceDescriptionButton.addEventListener("click", () => {
    voiceDescriptionButton.disabled = true;
    voiceDescriptionButton.textContent = "듣는 중";
    recognition.start();
  });

  recognition.addEventListener("result", (event) => {
    const descriptionInput = document.querySelector("#description");
    const text = event.results[0][0].transcript.trim();
    descriptionInput.value = [descriptionInput.value.trim(), text].filter(Boolean).join("\n");
  });

  recognition.addEventListener("end", () => {
    voiceDescriptionButton.disabled = false;
    voiceDescriptionButton.textContent = "음성 입력";
  });

  recognition.addEventListener("error", () => {
    voiceDescriptionButton.disabled = false;
    voiceDescriptionButton.textContent = "키보드 마이크";
    focusDescriptionForKeyboardDictation();
  });
}

function focusTitleForKeyboardDictation() {
  const titleInput = document.querySelector("#title");
  titleInput.focus();
  setSaveStatus("아이폰에서는 제목 칸을 누른 뒤 키보드의 마이크 버튼으로 받아쓰기를 사용해보세요.");
}

function focusDescriptionForKeyboardDictation() {
  const descriptionInput = document.querySelector("#description");
  descriptionInput.focus();
  setSaveStatus("아이폰에서는 설명 칸을 누른 뒤 키보드의 마이크 버튼으로 받아쓰기를 사용해보세요.");
}

async function initializeApp() {
  records = await loadRecords();
  renderRecords();
}

async function loadRecords() {
  if (!window.indexedDB) {
    return loadRecordsFromLocalStorage();
  }

  try {
    const db = await openRecordsDb();
    const savedRecords = await readRecordsFromDb(db);

    if (Array.isArray(savedRecords)) {
      return savedRecords;
    }

    const localRecords = loadRecordsFromLocalStorage();

    if (localRecords.length > 0) {
      await writeRecordsToDb(db, localRecords);
      localStorage.removeItem(STORAGE_KEY);
    }

    return localRecords;
  } catch {
    return loadRecordsFromLocalStorage();
  }
}

function loadRecordsFromLocalStorage() {
  const savedRecords = localStorage.getItem(STORAGE_KEY);

  if (!savedRecords) {
    return [];
  }

  try {
    return JSON.parse(savedRecords);
  } catch {
    return [];
  }
}

async function saveRecords() {
  if (!window.indexedDB) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return;
  }

  const db = await openRecordsDb();
  await writeRecordsToDb(db, records);
  localStorage.removeItem(STORAGE_KEY);
}

function openRecordsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.addEventListener("upgradeneeded", () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function readRecordsFromDb(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORDS_DB_KEY);

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function writeRecordsToDb(db, nextRecords) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(nextRecords, RECORDS_DB_KEY);
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}

function renderRecords() {
  recordCount.textContent = `${records.length}개의 기록`;

  if (records.length === 0) {
    recordList.innerHTML = `<div class="empty-list">아직 저장된 기록이 없습니다.</div>`;
    return;
  }

  recordList.innerHTML = records.map(renderRecordCard).join("");
}

function renderRecordCard(record) {
  const tags = (record.tags || [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");

  const photos = getRecordPhotos(record);
  const photoMarkup =
    photos.length > 0
      ? photos
          .slice(0, 4)
          .map((photo) => `<img src="${photo.dataUrl}" alt="${escapeHtml(record.title)} 사진" />`)
          .join("")
      : `<div class="record-photo-placeholder">사진 없음</div>`;

  const location = record.location || "위치 메모 없음";
  const audio = record.audioName || "음성메모 없음";
  const description = record.description || "설명 메모 없음";
  const audioPlayer = record.audioDataUrl
    ? `<audio class="record-audio" src="${record.audioDataUrl}" controls></audio>`
    : "";
  const audioSummary = record.audioSummary
    ? `<div class="summary-box"><strong>녹음 요약</strong>${escapeHtml(record.audioSummary)}</div>`
    : "";
  const audioTranscript = record.audioTranscript
    ? `<details class="transcript-box"><summary>전체 녹음 텍스트</summary><p>${escapeHtml(record.audioTranscript)}</p></details>`
    : "";

  return `
    <article class="record-card">
      <div class="record-photo">${photoMarkup}</div>
      <div class="record-content">
        <button class="edit-button secondary-button" type="button" data-edit-id="${escapeHtml(record.id)}">수정</button>
        <h3>${escapeHtml(record.title)}</h3>
        <p class="meta-row">작성: ${escapeHtml(record.createdAt)}</p>
        <p class="meta-row">위치: ${escapeHtml(location)}</p>
        <p class="meta-row">음성: ${escapeHtml(audio)}</p>
        ${audioPlayer}
        ${audioSummary}
        ${audioTranscript}
        <p class="description">${escapeHtml(description)}</p>
        <div class="tag-list">${tags || `<span class="tag">태그 없음</span>`}</div>
      </div>
    </article>
  `;
}

function parseTags(value) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function readPhotoFile(file) {
  return compressImageFile(file).then((dataUrl) => ({
    name: file.name,
    dataUrl,
  }));
}

function compressImageFile(file) {
  return new Promise((resolve) => {
    const image = new Image();
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      image.src = reader.result;
    });

    image.addEventListener("load", () => {
      const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);

      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", IMAGE_QUALITY));
    });

    image.addEventListener("error", async () => {
      resolve(await readBlobAsDataUrl(file));
    });

    reader.readAsDataURL(file);
  });
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", reject);
    reader.readAsDataURL(blob);
  });
}

function renderPhotoPreview() {
  if (selectedPhotos.length === 0) {
    photoPreview.className = "photo-preview empty";
    photoPreview.textContent = "사진 미리보기";
    return;
  }

  photoPreview.className = "photo-preview";
  photoPreview.innerHTML = selectedPhotos
    .map((photo) => `<img src="${photo.dataUrl}" alt="${escapeHtml(photo.name)} 미리보기" />`)
    .join("");
}

function getRecordPhotos(record) {
  if (Array.isArray(record.photos) && record.photos.length > 0) {
    return record.photos;
  }

  if (record.photoDataUrl) {
    return [
      {
        name: record.photoName || "사진",
        dataUrl: record.photoDataUrl,
      },
    ];
  }

  return [];
}

function resetForm() {
  form.reset();
  editingRecordId = null;
  selectedPhotos = [];
  recordedAudioDataUrl = "";
  recordedChunks = [];
  recordedAudio.removeAttribute("src");
  recordedAudio.hidden = true;
  audioTranscript.value = "";
  recordingTranscriptParts = [];
  recordingStatus.textContent = "아직 녹음된 음성메모가 없습니다.";
  startRecordingButton.disabled = false;
  stopRecordingButton.disabled = true;
  renderPhotoPreview();
}

function startEditRecord(record) {
  editingRecordId = record.id;
  const titleInput = document.querySelector("#title");
  const locationInput = document.querySelector("#location");
  const descriptionInput = document.querySelector("#description");
  const tagsInput = document.querySelector("#tags");

  titleInput.value = record.title || "";
  locationInput.value = record.location || "";
  descriptionInput.value = record.description || "";
  tagsInput.value = (record.tags || []).join(", ");
  audioTranscript.value = record.audioTranscript || "";
  recordedAudioDataUrl = record.audioDataUrl || "";
  selectedPhotos = getRecordPhotos(record);

  if (recordedAudioDataUrl) {
    recordedAudio.src = recordedAudioDataUrl;
    recordedAudio.hidden = false;
  } else {
    recordedAudio.removeAttribute("src");
    recordedAudio.hidden = true;
  }

  recordingStatus.textContent = "기존 기록을 수정 중입니다.";
  renderPhotoPreview();
  setSaveStatus("기존 기록을 수정 중입니다. 내용을 고친 뒤 저장을 누르세요.");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function getAddressFromCoordinates(latitude, longitude) {
  const coordinateText = `위도 ${latitude}, 경도 ${longitude}`;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=ko`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return coordinateText;
    }

    const data = await response.json();
    const address = data.display_name;

    if (!address) {
      return coordinateText;
    }

    return `${address} (${coordinateText})`;
  } catch {
    return coordinateText;
  }
}

function startRecordingTranscription() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    recordingStatus.textContent = "녹음 중입니다. 이 브라우저에서는 녹음 텍스트 변환을 지원하지 않습니다.";
    return;
  }

  recordingTranscriptParts = [];
  recordingRecognition = new SpeechRecognition();
  recordingRecognition.lang = "ko-KR";
  recordingRecognition.continuous = true;
  recordingRecognition.interimResults = true;

  recordingRecognition.addEventListener("result", (event) => {
    let interimText = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript.trim();

      if (event.results[index].isFinal) {
        recordingTranscriptParts.push(text);
      } else {
        interimText = text;
      }
    }

    audioTranscript.value = [recordingTranscriptParts.join(" "), interimText].filter(Boolean).join(" ");
  });

  recordingRecognition.addEventListener("error", () => {
    recordingStatus.textContent = "녹음 중입니다. 음성 텍스트 변환은 지원되지 않거나 권한이 필요합니다.";
  });

  try {
    recordingRecognition.start();
  } catch {
    recordingRecognition = null;
  }
}

function stopRecordingTranscription() {
  if (!recordingRecognition) {
    return;
  }

  try {
    recordingRecognition.stop();
  } catch {
    // 이미 멈춘 경우에는 그대로 둡니다.
  }
}

function summarizeTranscript(transcript) {
  if (!transcript) {
    return "";
  }

  const sentences = transcript
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+|(?<=다)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return transcript.slice(0, 120);
  }

  return sentences.slice(0, 2).join(" ");
}

function createId() {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStorableAudioDataUrl() {
  if (!recordedAudioDataUrl) {
    return "";
  }

  if (recordedAudioDataUrl.length > MAX_AUDIO_SAVE_LENGTH) {
    setSaveStatus("녹음이 길어서 기록에는 제목만 저장했습니다. 짧게 녹음하면 재생까지 저장됩니다.", true);
    return "";
  }

  return recordedAudioDataUrl;
}

function setSaveStatus(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
