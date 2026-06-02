const STORAGE_KEY = "fieldExplorerRecords";

const form = document.querySelector("#recordForm");
const recordList = document.querySelector("#recordList");
const recordCount = document.querySelector("#recordCount");
const clearRecordsButton = document.querySelector("#clearRecords");
const photoInput = document.querySelector("#photo");
const photoPreview = document.querySelector("#photoPreview");
const clearPhotosButton = document.querySelector("#clearPhotos");
const voiceTitleButton = document.querySelector("#voiceTitleButton");
const startRecordingButton = document.querySelector("#startRecording");
const stopRecordingButton = document.querySelector("#stopRecording");
const recordingStatus = document.querySelector("#recordingStatus");
const recordedAudio = document.querySelector("#recordedAudio");
const getLocationButton = document.querySelector("#getLocation");
const saveStatus = document.querySelector("#saveStatus");

const MAX_PHOTOS = 6;
const MAX_IMAGE_SIZE = 1000;
const IMAGE_QUALITY = 0.72;
const MAX_AUDIO_SAVE_LENGTH = 1_500_000;

let records = loadRecords();
let selectedPhotos = [];
let mediaRecorder = null;
let recordedChunks = [];
let recordedAudioDataUrl = "";

renderRecords();
setupVoiceTitle();

photoInput.addEventListener("change", async () => {
  setSaveStatus("");
  const remainingSlots = MAX_PHOTOS - selectedPhotos.length;

  if (remainingSlots <= 0) {
    setSaveStatus(`사진은 테스트 버전에서 최대 ${MAX_PHOTOS}장까지 저장합니다.`, true);
    photoInput.value = "";
    return;
  }

  const files = Array.from(photoInput.files).slice(0, remainingSlots);

  if (photoInput.files.length > remainingSlots) {
    setSaveStatus(`사진은 테스트 버전에서 최대 ${MAX_PHOTOS}장까지 저장합니다.`, true);
  }

  const newPhotos = await Promise.all(files.map(readPhotoFile));
  selectedPhotos = selectedPhotos.concat(newPhotos);
  photoInput.value = "";
  renderPhotoPreview();
});

clearPhotosButton.addEventListener("click", () => {
  selectedPhotos = [];
  photoInput.value = "";
  renderPhotoPreview();
  setSaveStatus("첨부한 사진을 비웠습니다.");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const audioFile = formData.get("audio");

  const newRecord = {
    id: createId(),
    title: formData.get("title").trim(),
    photos: selectedPhotos,
    photoName: selectedPhotos[0]?.name || "",
    photoDataUrl: selectedPhotos[0]?.dataUrl || "",
    audioName: recordedAudioDataUrl ? "직접 녹음한 음성메모" : audioFile?.name || "",
    audioDataUrl: getStorableAudioDataUrl(),
    location: formData.get("location").trim(),
    description: formData.get("description").trim(),
    tags: parseTags(formData.get("tags")),
    createdAt: new Date().toLocaleString("ko-KR"),
  };

  try {
    records.unshift(newRecord);
    saveRecords();
    setSaveStatus("저장되었습니다. 아래 기록 목록에서 확인할 수 있습니다.");
  } catch {
    records.shift();
    setSaveStatus("저장 공간이 부족합니다. 사진 수를 줄이거나 짧은 녹음으로 다시 저장해주세요.", true);
    return;
  }

  renderRecords();
  resetForm();
});

clearRecordsButton.addEventListener("click", () => {
  if (records.length === 0) {
    return;
  }

  const shouldClear = confirm("저장된 모든 기록을 삭제할까요?");

  if (!shouldClear) {
    return;
  }

  records = [];
  saveRecords();
  renderRecords();
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
    });

    mediaRecorder.start();
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
  startRecordingButton.disabled = false;
  stopRecordingButton.disabled = true;
});

getLocationButton.addEventListener("click", () => {
  const locationInput = document.querySelector("#location");

  if (!navigator.geolocation) {
    locationInput.value = "이 브라우저에서는 위치 가져오기를 지원하지 않습니다.";
    return;
  }

  getLocationButton.disabled = true;
  getLocationButton.textContent = "확인 중";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latitude = position.coords.latitude.toFixed(6);
      const longitude = position.coords.longitude.toFixed(6);
      locationInput.value = `위도 ${latitude}, 경도 ${longitude}`;
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

function focusTitleForKeyboardDictation() {
  const titleInput = document.querySelector("#title");
  titleInput.focus();
  setSaveStatus("아이폰에서는 제목 칸을 누른 뒤 키보드의 마이크 버튼으로 받아쓰기를 사용해보세요.");
}

function loadRecords() {
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

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
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

  return `
    <article class="record-card">
      <div class="record-photo">${photoMarkup}</div>
      <div class="record-content">
        <h3>${escapeHtml(record.title)}</h3>
        <p class="meta-row">작성: ${escapeHtml(record.createdAt)}</p>
        <p class="meta-row">위치: ${escapeHtml(location)}</p>
        <p class="meta-row">음성: ${escapeHtml(audio)}</p>
        ${audioPlayer}
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
  selectedPhotos = [];
  recordedAudioDataUrl = "";
  recordedChunks = [];
  recordedAudio.removeAttribute("src");
  recordedAudio.hidden = true;
  recordingStatus.textContent = "아직 녹음된 음성메모가 없습니다.";
  startRecordingButton.disabled = false;
  stopRecordingButton.disabled = true;
  renderPhotoPreview();
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
