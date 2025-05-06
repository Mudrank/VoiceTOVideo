document.addEventListener("DOMContentLoaded", function () {
    // =====================
    // API Checks & Initial Debugging
    // =====================
    // Use !! for explicit boolean check, though truthiness check in if() is also common.
    const hasMediaDevices = !!navigator.mediaDevices?.getUserMedia; // Use optional chaining
    const hasMediaRecorder = !!window.MediaRecorder;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const hasSpeechRecognition = !!SpeechRecognition;
    const hasCanvasCaptureStream = !!HTMLCanvasElement.prototype.captureStream;
    const hasAudioContext = !!(window.AudioContext || window.webkitAudioContext);
    const isSecureContext = window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';


    console.log("Initial API Checks (these determine if recording *can* work):");
    console.log(`  - Page is HTTPS or localhost: ${isSecureContext}`);
    console.log(`  - hasMediaDevices (mic access API): ${hasMediaDevices}`);
    console.log(`  - hasMediaRecorder (recording API): ${hasMediaRecorder}`);
    console.log(`  - hasSpeechRecognition (transcript API): ${hasSpeechRecognition ? 'Yes' : 'No (Transcript will be manual)'}`);
    console.log(`  - hasCanvasCaptureStream (video API): ${hasCanvasCaptureStream}`);
    console.log(`  - hasAudioContext (audio processing API): ${hasAudioContext}`);


    // =====================
    // DOM Elements (use const as these references won't change)
    // =====================
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const exportBtn = document.getElementById("exportBtn");
    const videoBtn = document.getElementById("videoBtn");
    const resetBtn = document.getElementById("resetBtn");
    const clearUIBtn = document.getElementById("clearUIBtn");
    const playPauseBtn = document.getElementById("playPauseBtn");
    const subtitle = document.getElementById("subtitle");
    const recordingIndicator = document.getElementById("recording-indicator");
    const audioDurationSpan = document.getElementById("audio-duration");
    const statusDiv = document.getElementById("status");
    const waveformContainer = document.getElementById("waveform");

    const audioFileNameInput = document.getElementById("audioFileNameInput");
    const videoFileNameInput = document.getElementById("videoFileNameInput");
    const transcriptFileNameInput = document.getElementById("transcriptFileNameInput");

    // =====================
    // Global State Variables (use let as these will be reassigned)
    // =====================
    let mediaRecorder = null; // Initialize with null
    let audioChunks = [];
    let recognition = null; // Initialize with null
    let finalTranscript = "";
    let stream = null; // Initialize with null
    let audioBlob = null; // Initialize with null
    let audioUrl = null; // Initialize with null
    let wavesurfer = null; // Initialize with null
    let isRecording = false;
    let isProcessingStop = false;
    let supportedAudioType = "";
    let statusTimeoutId = null;

    // Variables for video generation audio context
    let audioContextForVideo = null;
    let bufferSourceNodeForVideo = null;
    let destinationNodeForVideo = null;
    let canvasAnimationId = null;


    // =====================
    // Constants (moved related constants together)
    // =====================
    const MIN_RECORDING_BLOB_SIZE = 100;
    const STATUS_MESSAGE_DURATION = 4000;

    // Default filenames
    const DEFAULT_AUDIO_FILENAME_BASE = "recorded_audio";
    const DEFAULT_VIDEO_FILENAME_BASE = "generated_video";
    const DEFAULT_TRANSCRIPT_FILENAME_BASE = "transcript";

    // Preferred MIME types for recording (prioritize compatibility for decoding)
    const PREFERRED_AUDIO_MIME_TYPES = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4;codecs=mp4a.40.2", // AAC
        "audio/mp4", // Generic MP4
        "audio/mpeg", // MP3 (support varies for recording)
        "audio/ogg;codecs=opus", // Opus in Ogg
        "audio/ogg", // Generic Ogg
        "audio/wav" // WAV (simple, large files, support varies for recording)
    ];

    // Preferred MIME types for video output (prioritize compatibility for playback)
    const PREFERRED_VIDEO_MIME_TYPES = [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2", // H.264 + AAC
        "video/mp4", // Generic MP4
        "video/webm;codecs=vp9,opus", // VP9 + Opus
        "video/webm;codecs=vp8,vorbis", // VP8 + Vorbis (older webm)
        "video/webm" // Generic WebM
    ];


    // =====================
    // Utility Functions
    // =====================
    // Formats time in seconds to M:SS format
    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remaining = Math.floor(seconds % 60);
        return `${minutes}:${remaining.toString().padStart(2, "0")}`;
    }

    // Sanitizes input text for filenames and appends extension
    function getSanitizedFilename(inputElement, defaultBaseName, extension) {
        let filename = inputElement?.value.trim() || defaultBaseName; // Use optional chaining and fallback
        filename = filename.replace(/\.[^/.]+$/, ""); // Remove existing extension
        filename = filename.replace(/[/\\?%*:|"<>]/g, '').replace(/\s+/g, '_'); // Remove invalid chars, replace spaces
        // Optional: Limit length: filename = filename.substring(0, 100);
        return filename + extension;
    }

    // Triggers a download of a blob
    function downloadBlob(blob, filename) {
        if (!blob) {
            alert("Error: No data available for download.");
            return;
        }
        try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Revoke URL after a short delay
            setTimeout(() => URL.revokeObjectURL(url), 100);
            showStatus(`Download started: ${filename}`, "success", 2000);
        } catch (e) {
            console.error("Download failed:", e);
            alert(`Download failed:\n${e.message}`);
            showStatus("❌ Download failed.", "error");
        }
    }

    // Displays status messages in the dedicated div
    function showStatus(message, type = "info", duration = STATUS_MESSAGE_DURATION) {
        console.log(`Status (${type}): ${message}`);
        if (statusTimeoutId) clearTimeout(statusTimeoutId);
        statusTimeoutId = null;
        statusDiv.textContent = message;
        statusDiv.className = `status visible ${type}`; // Set class for styling and visibility
        if (duration > 0) {
            statusTimeoutId = setTimeout(() => {
                // Only clear if the message hasn't changed
                if (statusDiv.textContent === message) {
                    statusDiv.className = "status info"; // Revert to default class
                    statusDiv.textContent = ""; // Clear text
                }
            }, duration);
        }
    }


    // Updates the disabled state and text/placeholder of buttons and UI elements
    function updateButtonStates(state) {
        // Use boolean flags based on the state string
        const isIdle = state === "idle";
        const isRecordingState = state === "recording";
        const isRecorded = state === "recorded";
        const isProcessing = state === "processing";

        // --- Button States ---
        startBtn.disabled = !isIdle || isProcessing;
        stopBtn.disabled = !isRecordingState || isProcessingStop;
        // Reset/ClearUI require some data AND not be recording/processing
        resetBtn.disabled = (isIdle && !audioBlob && !subtitle.value.trim()) || isProcessing || isRecordingState;
        clearUIBtn.disabled = (isIdle && !audioBlob && !subtitle.value.trim()) || isProcessing || isRecordingState;
        // Play/Pause requires recorded state, not processing, and a ready wavesurfer
        playPauseBtn.disabled = !isRecorded || isProcessing || !wavesurfer?.isReady; // Use optional chaining
        // Download requires recorded state and audio data
        downloadBtn.disabled = !isRecorded || isProcessing || !audioBlob;
        // Export requires recorded state and transcription text
        exportBtn.disabled = !isRecorded || isProcessing || !subtitle.value.trim();
        // Video requires recorded state, audio, transcription, and browser features
        videoBtn.disabled = !isRecorded || isProcessing || !audioBlob || !subtitle.value.trim() || !hasCanvasCaptureStream || !hasAudioContext;

        // --- UI Element States ---
        subtitle.readOnly = isRecordingState || isProcessing; // Read-only during recording/processing

        // Control visibility and animation of the recording indicator element via CSS class
        recordingIndicator.classList.toggle('visible', isRecordingState);
        recordingIndicator.style.display = isRecordingState ? "flex" : "none"; // Ensure display is set correctly

        // --- Status Message and Placeholder Updates ---
        // Status messages for key states (Processing, Idle)
        if (isProcessing) {
            showStatus("⏳ Processing... Please wait.", "processing", 0); // Sticky status
        } else if (isIdle) {
            showStatus("Ready. Click 'Start Recording' to begin.", "info"); // Info status with duration
            // Update subtitle placeholder based on core API and context availability
            const canRecord = hasMediaDevices && hasMediaRecorder && isSecureContext;
            subtitle.placeholder = canRecord
                ? (hasSpeechRecognition ? 'Click "Start Recording" to begin speaking.' : 'Click "Start Recording" to record audio.')
                : "⚠️ Recording may not be possible (check HTTPS/localhost & browser features). Click Start to verify.";
        }
         // For 'recorded' state, status is typically set by the onstop/ready handlers (e.g., "Audio processed", "Waveform unavailable")
    }

    // --- Video Resource Cleanup Function ---
    // Consolidates the cleanup logic for video generation resources
    function cleanupVideoResources() {
        console.log("Cleaning up video generation resources.");
        // Stop and disconnect AudioBufferSourceNode
        if (bufferSourceNodeForVideo) {
            try { bufferSourceNodeForVideo.stop(); } catch (e) { console.warn("Error stopping bufferSourceNodeForVideo:", e); } // Stop might throw if already stopped
            try { bufferSourceNodeForVideo.disconnect(); } catch (e) { console.warn("Error disconnecting bufferSourceNodeForVideo:", e); }
             bufferSourceNodeForVideo = null; // Clear reference
        }
        // Disconnect MediaStreamDestination node
        if (destinationNodeForVideo) {
            try { destinationNodeForVideo.disconnect(); } catch (e) { console.warn("Error disconnecting destinationNodeForVideo:", e); }
             destinationNodeForVideo = null; // Clear reference
        }
        // Close the AudioContext gracefully
        if (audioContextForVideo && audioContextForVideo.state !== 'closed') {
            console.log("Attempting to close AudioContext for video.");
            audioContextForVideo.close().then(() => {
                audioContextForVideo = null;
                console.log("AudioContext for video closed.");
            }).catch(e => {
                console.warn("Error closing AudioContext for video:", e);
                audioContextForVideo = null; // Still clear the reference on error
            });
        } else {
             audioContextForVideo = null; // Ensure it's null if it was already closed or null
        }
        // Cancel the canvas animation frame
        if (canvasAnimationId) { cancelAnimationFrame(canvasAnimationId); canvasAnimationId = null; }
    }
    // --- End Video Resource Cleanup Function ---


    // Resets the application state and UI. Optionally preserves recorded audio/transcript.
    function resetApp(preserveAudio = false) {
        console.log("Resetting application. Preserve audio:", preserveAudio);
        isRecording = false;
        isProcessingStop = false;

        // Stop MediaRecorder if active and clear reference
        if (mediaRecorder?.state !== "inactive") { // Use optional chaining
            try { mediaRecorder?.stop(); } catch (e) { console.warn("Error stopping MediaRecorder during reset:", e); }
        }
        mediaRecorder = null;

        // Abort Speech Recognition if active
        if (recognition?.state !== 'idle') { // Use optional chaining and check state
            try { recognition?.abort(); } catch (e) { console.warn("Error aborting SpeechRecognition during reset:", e); }
        }
        // The 'recognition' instance itself is kept for potential reuse.

        // Stop media stream tracks and clear reference
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;

        // Clear audio data chunks from the last recording
        audioChunks = [];

        if (!preserveAudio) {
            // Clear transcript data
            finalTranscript = "";
            subtitle.value = "";
            // Revoke audio object URL (if created) and clear audio blob
            if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
            audioBlob = null;
            supportedAudioType = ""; // Clear recorded type
        }

        // Update subtitle placeholder based on API availability
        const canRecord = hasMediaDevices && hasMediaRecorder && isSecureContext;
         subtitle.placeholder = canRecord
            ? (hasSpeechRecognition ? 'Click "Start Recording" to begin speaking.' : 'Click "Start Recording" to record audio.')
            : "⚠️ Recording may not be possible (check HTTPS/localhost & browser features). Click Start to verify.";

        // Reset audio duration display
        audioDurationSpan.textContent = "0:00";
        // Reset playback button text
        playPauseBtn.textContent = "Play";

        // Reset/Clear WaveSurfer instance state
        if (wavesurfer) {
            try {
                if (wavesurfer.isPlaying()) wavesurfer.stop(); // Stop playback
                // Clear waveform display if not preserving audio or if audioBlob is null
                if (!preserveAudio || !audioBlob) wavesurfer.empty();
                // Reset the custom ready state flag
                wavesurfer.isReady = preserveAudio && audioBlob && wavesurfer.isReady; // Keep ready state only if preserving audio AND it was already ready
                 console.log("WaveSurfer reset state.");
            } catch (e) { console.warn("Error resetting WaveSurfer:", e); }
            // The wavesurfer instance itself is generally preserved unless critically failed.
        }

        // Clean up video generation resources using the dedicated function
        cleanupVideoResources();

        // Clear any pending status message timeout and the status div
        if (statusTimeoutId) { clearTimeout(statusTimeoutId); statusTimeoutId = null; }
         statusDiv.className = "status info";
         statusDiv.textContent = "";

        // Update button states based on whether audio was preserved
        showStatus("Application reset.", "info", 2000);
        updateButtonStates(audioBlob && preserveAudio ? "recorded" : "idle");
    }

    // Starts the audio recording process
    async function startRecording() {
        // --- Initial API and context checks ---
        // Combine checks for clarity
        if (!hasMediaDevices || !hasMediaRecorder || !isSecureContext) {
            const errorMessage = !hasMediaDevices || !hasMediaRecorder
                ? "Required browser features (MediaDevices or MediaRecorder API) are not available or not supported.\n\nPlease use a modern browser (like Chrome, Firefox, Edge, Safari)."
                : "Microphone access requires a secure connection (HTTPS) or for the page to be served from localhost.";
            alert(`Recording is not possible:\n${errorMessage}`);
            console.error(`Start recording aborted: ${errorMessage}`);
            return; // Stop the start process
        }
        // --- END Initial API Checks ---

        console.log("Attempting to start recording...");
        // Prevent starting if already recording or processing a stop
        if (isRecording || isProcessingStop) {
            showStatus("Cannot start recording: Already recording or processing.", "warning");
            return; // Stop the start process
        }

        resetApp(false); // Perform a full reset before starting a new recording

        isRecording = true; // Set state flag early

        // --- Get Microphone Access ---
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log("Microphone access granted.");
        } catch (err) {
            console.error("Microphone error:", err);
            alert(`Microphone Access Denied or Error:\n${err.message}\n\nPlease grant microphone permission in your browser settings and try again.`);
            isRecording = false; // Reset state flag
            updateButtonStates("idle"); // Update UI to reflect idle state
            return; // Stop the start process
        }
        // --- End Get Microphone Access ---

        // --- Determine Supported Audio Format ---
        supportedAudioType = PREFERRED_AUDIO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));

        if (!supportedAudioType) {
            console.error("No supported MIME type for audio recording found.");
            alert("Recording Error:\nNo suitable audio format is supported by this browser for recording.");
            stream.getTracks().forEach((track) => track.stop()); // Clean up acquired stream
            stream = null;
            isRecording = false; updateButtonStates("idle");
            return; // Stop the start process
        }
        console.log(`Using audio format: ${supportedAudioType}`);
        // --- End Determine Supported Audio Format ---


        // --- Initialize MediaRecorder ---
        try {
            mediaRecorder = new MediaRecorder(stream, { mimeType: supportedAudioType });
             console.log("MediaRecorder initialized.");
        } catch (e) {
            console.error("MediaRecorder initialization error:", e);
            alert(`Recorder Setup Error:\nCould not initialize the MediaRecorder.\n${e.message}`);
            stream.getTracks().forEach((track) => track.stop()); // Clean up acquired stream
            stream = null;
            isRecording = false; updateButtonStates("idle");
            return; // Stop the start process
        }
        // --- End Initialize MediaRecorder ---


        // --- MediaRecorder Event Handlers ---
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
                 console.log(`Data available: ${event.data.size} bytes`);
            }
        };

        mediaRecorder.onstop = () => {
            console.log("MediaRecorder onstop triggered.");
            isRecording = false;
            isProcessingStop = false; // Processing of recorded data is now starting

            stream?.getTracks().forEach((track) => track.stop()); // Ensure stream tracks are stopped
            stream = null; // Clear stream reference

            if (audioChunks.length === 0) {
                console.warn("No audio data captured.");
                showStatus("⚠️ Recording failed: No audio data.", "warning");
                resetApp(false); // Reset completely if no data
                return;
            }

            // --- Create Audio Blob ---
            try {
                audioBlob = new Blob(audioChunks, { type: supportedAudioType });
                console.log(`Audio Blob created: ${audioBlob.size} bytes, Type: ${audioBlob.type}`);
                audioChunks = []; // Clear chunks array

                if (audioBlob.size < MIN_RECORDING_BLOB_SIZE) {
                    console.warn("Audio blob size is too small.", audioBlob.size);
                    showStatus("Recording too short.", "warning");
                    resetApp(false); // Reset completely if too short
                    return;
                }
            } catch (e) {
                console.error("Error creating audio blob:", e);
                alert(`Audio Processing Error after recording:\n${e.message}`);
                resetApp(false); // Reset completely on blob creation error
                return;
            }
            // --- End Create Audio Blob ---


            // --- Process Audio Blob (Waveform/Playback) ---
            if (wavesurfer) {
                updateButtonStates("processing");
                showStatus("⏳ Processing audio waveform...", "processing", 0);
                try {
                    // Asynchronous operation, errors go to wavesurfer.on('error')
                   wavesurfer.loadBlob(audioBlob);
                   console.log("wavesurfer.loadBlob called.");

                  // wavesurfer.load('recorded_audio.webm'); 
                  // console.log("wavesurfer.load called with static file.");

                    // UI state updates (to 'recorded') happen in wavesurfer.on('ready') or wavesurfer.on('error')
                } catch (loadError) {
                    // Catch SYNC errors during loadBlob call
                    console.error("Synchronous error during wavesurfer.loadBlob call:", loadError);
                    alert(`Waveform Load Error (sync): ${loadError.message}`);
                    // Destroy Wavesurfer on sync error
                    if (wavesurfer) {
                        try { wavesurfer.destroy(); } catch(e) { console.warn("Error destroying wavesurfer after sync error:", e); }
                        wavesurfer = null;
                    }
                    resetApp(true); // Reset UI but try to preserve audio blob
                }
            } else {
                console.warn("WaveSurfer instance not available. Falling back to basic audio info.");
                updateButtonStates("recorded");
                showStatus("✅ Audio recorded. Waveform unavailable.", "success");
                subtitle.readOnly = false;
                subtitle.placeholder = "Transcription ready. Edit if needed.";

                // Attempt to get duration using a temporary HTML audio element
                const tempAudio = document.createElement('audio');
                tempAudio.onloadedmetadata = () => {
                    console.log("Temporary audio element loaded metadata.");
                    audioDurationSpan.textContent = formatTime(tempAudio.duration);
                    URL.revokeObjectURL(tempAudio.src);
                };
                tempAudio.onerror = (e) => {
                    console.error("Temporary audio element error:", e);
                    showStatus("⚠️ Audio recorded, but playback/duration failed (temp element).", "warning");
                    if (tempAudio.src) URL.revokeObjectURL(tempAudio.src);
                };
                tempAudio.onabort = () => {
                      console.warn("Temporary audio element aborted loading.");
                      if (tempAudio.src) URL.revokeObjectURL(tempAudio.src);
                };
                tempAudio.src = URL.createObjectURL(audioBlob);
                console.log("Attempting to load blob into temporary audio element.");
            }
            // --- End Process Audio Blob ---
        };

        // Handle errors during the recording session
        mediaRecorder.onerror = (event) => {
            console.error("MediaRecorder error during session:", event.error);
            showStatus(`❌ Recording Error: ${event.error.name || 'Unknown'}`, "error", 0);
            // Force reset after a short delay if still in recording/processing state
            setTimeout(() => {
                 if (isRecording || isProcessingStop) {
                    console.warn("Forcing reset after MediaRecorder error timeout.");
                    resetApp(false);
                 }
            }, 50);
        };
         // --- End MediaRecorder Event Handlers ---


        // --- Speech Recognition Setup and Start ---
        if (hasSpeechRecognition) {
            if (!recognition) {
                recognition = new SpeechRecognition();
                recognition.lang = "en-US";
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.maxAlternatives = 1;

                recognition.onstart = () => { console.log("SpeechRecognition started."); };
                recognition.onresult = (event) => {
                    let interim = "";
                    let currentFinal = "";
                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        const result = event.results[i][0];
                        const transcript = result.transcript;
                        if (event.results[i].isFinal) currentFinal += transcript.trim() + " ";
                        else interim += transcript;
                    }
                    if (currentFinal) finalTranscript += currentFinal;
                    subtitle.value = (finalTranscript + interim).trim();
                    subtitle.scrollTop = subtitle.scrollHeight;
                };
                recognition.onerror = (e) => {
                    console.error("SpeechRecognition error:", e);
                    if (!["no-speech", "aborted", "audio-capture"].includes(e.error)) {
                        showStatus(`⚠️ Speech Rec Error: ${e.error}.`, "warning");
                    }
                };
                recognition.onend = () => {
                    console.log("SpeechRecognition ended.");
                    subtitle.value = finalTranscript.trim();
                };
            }
            // Attempt to start speech recognition
            try {
                 if (recognition?.state !== 'recognizing') { // Use optional chaining and check state
                    recognition?.start(); // Use optional chaining
                     console.log("SpeechRecognition start attempt.");
                 } else {
                     console.log("SpeechRecognition already running.");
                 }
            } catch (e) {
                if (e.name !== 'InvalidStateError') {
                   console.error("Synchronous error starting SpeechRecognition:", e);
                   showStatus(`⚠️ Speech Rec Warning: ${e.message}`, "warning");
                } else {
                     console.log("SpeechRecognition start() called in invalid state (likely already running or stopping).");
                }
            }
        } else {
            subtitle.placeholder = "Recording audio (speech recognition not supported by this browser)...";
             console.warn("Speech Recognition API not supported in this browser.");
        }
         // --- End Speech Recognition Setup and Start ---


        // --- Start MediaRecorder ---
        try {
            mediaRecorder.start();
            console.log("MediaRecorder started successfully.");
            updateButtonStates("recording"); // Update UI state now that recording has successfully begun
        } catch (e) {
            console.error("Critical Error: Failed to start MediaRecorder:", e);
            alert(`Critical Error: Failed to start MediaRecorder.\n${e.message}`);
            // Clean up resources if MediaRecorder start fails immediately
            stream?.getTracks().forEach((track) => track.stop());
            stream = null;
            if (recognition?.state !== 'idle') { // Abort SR if active
                try { recognition?.abort(); } catch (err) { console.warn("Error aborting SR after MR start failure:", err); }
            }
            isRecording = false; updateButtonStates("idle"); // Revert UI state
        }
         // --- End Start MediaRecorder ---
    }

    // Stops the audio recording process
    function stopRecording() {
        if (!isRecording || isProcessingStop) {
             console.log("Stop requested, but not recording or already processing stop.");
            return;
        }
        console.log("Attempting to stop recording...");
        isProcessingStop = true; // Set flag to indicate stop process has begun
        updateButtonStates("processing"); // Update UI state to processing
        showStatus("⏳ Stopping recording...", "processing", 0); // Show processing status

        // Attempt to stop Speech Recognition if it's active
        if (recognition?.state !== 'idle') { // Use optional chaining and check state
            try {
                 recognition.stop(); // Use optional chaining
                 console.log("SpeechRecognition stop requested.");
            } catch (e) {
                 console.warn("Error stopping SpeechRecognition:", e);
            }
        }

        // Attempt to stop MediaRecorder
        if (mediaRecorder?.state === "recording" || mediaRecorder?.state === "paused") { // Use optional chaining
            try {
                mediaRecorder.stop(); // Use optional chaining
                 console.log("MediaRecorder stop requested.");
                // The asynchronous 'onstop' event handler will be triggered after this call
                // to handle the processing of the recorded data.
            } catch (e) {
                console.error("Error calling mediaRecorder.stop():", e);
                showStatus(`❌ Error stopping recording: ${e.message}`, "error");
                // Implement a fallback force-reset after a short delay
                setTimeout(() => {
                     if (isProcessingStop) { // Check the flag to ensure we haven't already reset
                        console.warn("Forcing application reset after MediaRecorder stop error timeout.");
                        resetApp(false); // Reset to a clean state
                     }
                }, 2000); // Wait 2 seconds before forcing the reset
            }
        } else {
             console.warn("MediaRecorder not in 'recording' or 'paused' state when stop was called. Initiating reset.");
            // If MediaRecorder is not in an stoppable state, something is wrong, so just reset.
            resetApp(false);
        }
    }

    // Generates a video with the transcription overlaid on a background using Canvas
    async function generateVideo() {
        // Get the current transcription text
        const currentTranscript = subtitle.value.trim();

        // --- Pre-generation checks ---
        if (!audioBlob) {
            showStatus("❌ No audio data available for video generation.", "error");
            console.warn("Video generation aborted: No audio blob.");
            return;
        }
        if (!currentTranscript) {
            showStatus("❌ Transcription is empty. Video requires transcription.", "error");
            console.warn("Video generation aborted: Empty transcript.");
            return;
        }
        if (!hasCanvasCaptureStream || !hasAudioContext) {
             showStatus("❌ Browser lacks required features (Canvas.captureStream or AudioContext) for video generation.", "error", 0);
            console.error("Video generation aborted: Missing browser features.");
            return;
        }
        // --- End Pre-generation checks ---


        updateButtonStates("processing"); // Set UI state to processing
        showStatus("⏳ Generating video... This may take a moment.", "processing", 0); // Sticky processing status
        console.log("Starting video generation process...");

        // --- Canvas Setup ---
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const width = 720; // Vertical format dimensions
        const height = 1280;
        canvas.width = width;
        canvas.height = height;

        // Get colors from CSS variables
        const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text-light").trim() || "#ffffff";
        const bgColor = getComputedStyle(document.documentElement).getPropertyValue("--bg-dark").trim() || "#222222";

        const fontSize = 40;
        const textLineHeight = 50;
        ctx.font = `bold ${fontSize}px 'Archivo', sans-serif`; // Set font style
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const textPadding = width * 0.1;
        const maxWidth = width - 2 * textPadding;
        const centerY = height / 2;

        // --- Text Wrapping Function ---
        function drawWrappedText(context, text, x, y, textMaxWidth, lineHeight) {
            const words = text.split(" ");
            let line = "";
            const lines = [];

            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + (n < words.length - 1 ? " " : "");
                const testWidth = context.measureText(testLine).width;
                if (testWidth > textMaxWidth && n > 0) {
                    lines.push(line.trim());
                    line = words[n] + (n < words.length - 1 ? " " : "");
                } else {
                    line = testLine;
                }
            }
            if (line.trim() !== "") lines.push(line.trim());

            const totalTextHeight = lines.length * lineHeight;
            let currentY = y - totalTextHeight / 2 + lineHeight / 2;

            lines.forEach((singleLine) => {
                context.fillText(singleLine, x, currentY);
                currentY += lineHeight;
            });
             // return lines.length; // Return number of lines drawn (optional)
        }
        // --- End Text Wrapping Function ---


        // --- Canvas Animation Loop ---
        function animateCanvas() {
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = textColor;
            drawWrappedText(ctx, currentTranscript, width / 2, centerY, maxWidth, textLineHeight);
            canvasAnimationId = requestAnimationFrame(animateCanvas);
        }

        animateCanvas(); // Start the canvas animation loop
         console.log("Canvas animation started.");
        // --- End Canvas Animation Loop ---


        // --- Get Video Stream from Canvas ---
        let canvasStream;
        try {
            canvasStream = canvas.captureStream(30); // Capture stream at 30 fps
            if (!canvasStream?.getVideoTracks().length) { // Use optional chaining
                throw new Error("Canvas captureStream failed or returned no video tracks.");
            }
             console.log("Canvas captureStream obtained.");
        } catch (e) {
            console.error("Canvas captureStream error:", e);
            showStatus(`❌ Video Error (Canvas Capture): ${e.message}`, "error", 0);
            cleanupVideoResources(); // Clean up video resources
            // Stop any tracks that might have been created
            canvasStream?.getTracks().forEach(track => track.stop());
            updateButtonStates("recorded");
            return;
        }
        // --- End Get Video Stream from Canvas ---


        // --- Get Audio Stream from Blob using Web Audio API ---
        let audioStreamFromBlob;
        let audioDuration = 0;
        try {
            // Clean up previous AudioContext for video if it exists
            if (audioContextForVideo?.state !== 'closed') { // Use optional chaining
                console.log("Closing existing AudioContext for video.");
                await audioContextForVideo?.close().catch(e => console.warn("Error closing previous AudioContext:", e)); // Use optional chaining
            }
            // Create new AudioContext and MediaStreamDestination
            audioContextForVideo = new (window.AudioContext || window.webkitAudioContext)();
            destinationNodeForVideo = audioContextForVideo.createMediaStreamDestination();
            audioStreamFromBlob = destinationNodeForVideo.stream;

            // Decode the audio blob data
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBufferDecoded = await audioContextForVideo.decodeAudioData(arrayBuffer);
            audioDuration = audioBufferDecoded.duration;
             console.log(`Audio blob decoded, duration: ${audioDuration} seconds`);

            // Create and connect AudioBufferSourceNode
            bufferSourceNodeForVideo = audioContextForVideo.createBufferSource();
            bufferSourceNodeForVideo.buffer = audioBufferDecoded;
            bufferSourceNodeForVideo.connect(destinationNodeForVideo);

             // Stop video recorder when audio finishes
             bufferSourceNodeForVideo.onended = () => {
                 console.log("AudioBufferSourceNode finished playing.");
                 if (videoRecorder?.state === "recording") { // Use optional chaining
                     console.log("Stopping video recorder because audio finished.");
                     try { videoRecorder?.stop(); } catch (e) { console.warn("Error stopping video recorder from audio onended:", e); } // Use optional chaining
                 } else {
                     console.log("Video recorder not in 'recording' state when audio finished.");
                 }
             };

        } catch (e) {
            console.error("Audio setup from blob error:", e);
            showStatus(`❌ Video Error (Audio Setup): ${e.message}`, "error", 0);
            cleanupVideoResources(); // Clean up video resources
            canvasStream?.getTracks().forEach(track => track.stop()); // Stop canvas stream tracks
            updateButtonStates("recorded");
            return;
        }
        // --- End Get Audio Stream from Blob ---


        // --- Combine Streams and Record Video ---
        // Determine the best supported video MIME type
        let videoMimeType = PREFERRED_VIDEO_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
        console.log(`Using video output MIME type: ${videoMimeType}`);

        const videoFileExtension = videoMimeType.includes("mp4") ? ".mp4" : ".webm";

        const videoChunks = [];

        // Combine canvas video track and audio stream audio track
        const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioStreamFromBlob.getAudioTracks()]);

        let videoRecorder;
        try {
            videoRecorder = new MediaRecorder(combinedStream, { mimeType: videoMimeType });
             console.log("Video MediaRecorder initialized.");
        } catch (e) {
            console.error("Video MediaRecorder initialization error:", e);
            showStatus(`❌ Video Error (Recorder Setup): ${e.message}`, "error", 0);
            combinedStream.getTracks().forEach(track => track.stop()); // Stop combined stream tracks
            cleanupVideoResources(); // Clean up video resources
            updateButtonStates("recorded");
            return;
        }

        // --- Video Recorder Event Handlers ---
        videoRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                videoChunks.push(e.data);
                 console.log(`Video data available: ${e.data.size} bytes`);
            }
        };

        videoRecorder.onstop = () => {
            console.log("VideoRecorder onstop triggered.");
            combinedStream.getTracks().forEach(track => track.stop()); // Stop combined stream tracks
            cleanupVideoResources(); // Clean up video resources

            if (videoChunks.length === 0) {
                console.warn("No video data captured during recording.");
                showStatus("❌ Video generation failed: No data captured.", "error");
                updateButtonStates("recorded");
                return;
            }

            const videoOutBlob = new Blob(videoChunks, { type: videoMimeType });
            console.log(`Video Blob created: ${videoOutBlob.size} bytes, Type: ${videoOutBlob.type}`);

            const filename = getSanitizedFilename(videoFileNameInput, DEFAULT_VIDEO_FILENAME_BASE, videoFileExtension);
            downloadBlob(videoOutBlob, filename);

            // Status updated by downloadBlob success, then state updated here
            updateButtonStates("recorded");
        };

        videoRecorder.onerror = (e) => {
            console.error("VideoRecorder error:", e);
            showStatus(`❌ Video Generation Error: ${e.error?.name || 'Unknown'}`, "error", 0);

            combinedStream.getTracks().forEach(track => track.stop()); // Stop combined stream tracks
            cleanupVideoResources(); // Clean up video resources

            updateButtonStates("recorded");
        };
        // --- End Video Recorder Event Handlers ---


        // --- Start Audio Playback and Video Recording ---
        try {
             console.log("Starting audio source node for video.");
            bufferSourceNodeForVideo.start();

             console.log("Starting video recorder.");
            videoRecorder.start();

            // Set a timeout to stop the video recorder after the audio duration + buffer
            // This acts as a safeguard if the audio.onended doesn't fire.
            const stopTimeout = (audioDuration * 1000) + 500; // Add 500ms buffer
            console.log(`Scheduled video recorder stop via timeout in ${stopTimeout} ms.`);

            setTimeout(() => {
                if (videoRecorder?.state === "recording") { // Use optional chaining
                    console.log("Stopping video recorder via duration timeout.");
                    try { videoRecorder?.stop(); } catch (e) { console.warn("Error stopping video recorder via timeout:", e); }
                } else {
                     console.log("Video recorder not in 'recording' state when timeout fired.");
                }
            }, stopTimeout);

        } catch (e) {
            console.error("Error starting audio source node or video recorder:", e);
            showStatus(`❌ Failed to start video recording process: ${e.message}`, "error", 0);
            // Clean up resources on immediate start error
            combinedStream?.getTracks().forEach(track => track.stop()); // Stop combined stream tracks
            cleanupVideoResources(); // Clean up video resources
            updateButtonStates("recorded");
        }
         // --- End Combine Streams and Record Video ---
    }


    // =====================
    // Event Listeners
    // =====================
    startBtn.addEventListener("click", startRecording);
    stopBtn.addEventListener("click", stopRecording);

    downloadBtn.addEventListener("click", () => {
        if (audioBlob && supportedAudioType) {
            // Determine extension based on recorded type (using includes for flexibility)
            let extension = ".bin"; // Fallback
            if (supportedAudioType.includes("mpeg") || supportedAudioType.includes("mp3")) extension = ".mp3";
            else if (supportedAudioType.includes("mp4")) extension = ".mp4";
            else if (supportedAudioType.includes("webm")) extension = ".webm";
            else if (supportedAudioType.includes("ogg")) extension = ".ogg";
            else if (supportedAudioType.includes("wav")) extension = ".wav";

            const filename = getSanitizedFilename(audioFileNameInput, DEFAULT_AUDIO_FILENAME_BASE, extension);
            downloadBlob(audioBlob, filename);
        } else { // Handles !audioBlob and missing supportedAudioType
            showStatus("No audio to download or file type unknown.", "warning");
        }
    });

    exportBtn.addEventListener("click", () => {
        if (subtitle.value.trim()) {
            const blob = new Blob([subtitle.value], { type: "text/plain;charset=utf-8" });
            const filename = getSanitizedFilename(transcriptFileNameInput, DEFAULT_TRANSCRIPT_FILENAME_BASE, ".txt");
            downloadBlob(blob, filename);
        } else showStatus("No transcript to export.", "warning");
    });

    videoBtn.addEventListener("click", generateVideo);

    resetBtn.addEventListener("click", () => {
        if (audioBlob || subtitle.value.trim()) {
            if (!confirm("Are you sure you want to reset? This will clear all recorded audio and transcript data.")) {
                return;
            }
        }
        resetApp(false); // Full reset
    });

    clearUIBtn.addEventListener("click", () => {
        if (subtitle.value.trim()) {
             if (!confirm("Are you sure you want to clear the transcript?")) {
                return;
             }
        }
        subtitle.value = "";
        finalTranscript = "";
        subtitle.placeholder = "Transcription cleared. Audio data (if any) is preserved.";
        updateButtonStates(audioBlob ? "recorded" : "idle"); // Update state based on preserved audio
        showStatus("Transcription cleared.", "info");
    });

    playPauseBtn.addEventListener("click", () => {
        if (wavesurfer?.isReady) { // Use optional chaining
            wavesurfer.playPause();
        } else if (!wavesurfer) {
             showStatus("Waveform player not available.", "warning");
        } else {
             showStatus("Waveform is not ready yet. Please wait.", "warning");
        }
    });


    // =====================
    // Initialization
    // =====================
    function initializeWaveSurfer() {
        if (typeof WaveSurfer === "undefined") {
            waveformContainer.textContent = "WaveSurfer library not found. Audio playback and waveform visualization disabled.";
            playPauseBtn.disabled = true;
            console.error("WaveSurfer library not found. Make sure wavesurfer.js is included.");
            return;
        }

        // Clear container and create element for Wavesurfer
        waveformContainer.innerHTML = '';
        const wavesurferElement = document.createElement('div');
        // wavesurferElement.style.width = '100%'; wavesurferElement.style.height = '100%';
        waveformContainer.appendChild(wavesurferElement);

        try {
            wavesurfer = WaveSurfer.create({
                container: wavesurferElement,
                // Use CSS variables for colors - Ensure these are defined in your CSS
                waveColor: getComputedStyle(document.documentElement).getPropertyValue('--wave-color')?.trim() || "#a8dadc", // Use optional chaining and fallback
                progressColor: getComputedStyle(document.documentElement).getPropertyValue('--wave-progress')?.trim() || "#ff6b6b", // Use optional chaining and fallback
                barWidth: 3,
                barRadius: 3,
                height: 100,
                responsive: true,
                hideScrollbar: true,
                cursorColor: getComputedStyle(document.documentElement).getPropertyValue('--text-light')?.trim() || "#ffffff", // Use optional chaining and fallback
                cursorWidth: 1,
                // Optional: Add backgroundColor if you want the space behind bars colored
                // backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--wave-bg')?.trim() || "#1d3557",
            });
            wavesurfer.isReady = false; // Custom flag

            // --- WaveSurfer Event Handlers ---
            wavesurfer.on("ready", () => {
                console.log("WaveSurfer ready event. Audio loaded and processed.");
                wavesurfer.isReady = true;
                audioDurationSpan.textContent = formatTime(wavesurfer.getDuration());
                subtitle.readOnly = false;
                subtitle.placeholder = "Transcription ready. Edit if needed.";
                updateButtonStates("recorded");
                showStatus("✅ Audio processed and waveform loaded.", "success");
            });

            wavesurfer.on("play", () => { playPauseBtn.textContent = "Pause"; console.log("WaveSurfer playback started."); });
            wavesurfer.on("pause", () => { playPauseBtn.textContent = "Play"; console.log("WaveSurfer playback paused."); });
            wavesurfer.on("finish", () => { playPauseBtn.textContent = "Play"; wavesurfer.seekTo(0); console.log("WaveSurfer playback finished."); });

            wavesurfer.on("error", (err) => {
                console.error("WaveSurfer error:", err); // Log the specific error object!
                showStatus(`❌ Waveform Error: ${err?.message || err}`, "error"); // Use optional chaining

                if (wavesurfer) {
                    try { wavesurfer.destroy(); } catch(e) { console.warn("Error destroying wavesurfer after error:", e); }
                    wavesurfer = null; // Nullify the instance on error
                }
                waveformContainer.textContent = `Waveform could not be loaded: ${err?.message || err}`; // Update container text
                resetApp(true); // Reset UI state, preserving audio if it exists
            });

            wavesurfer.on("destroy", () => {
                 console.log("WaveSurfer destroyed.");
                 waveformContainer.innerHTML = ""; // Clear container on destroy
             });
             // --- End WaveSurfer Event Handlers ---

             console.log("WaveSurfer instance created.");

        } catch (e) {
            console.error("WaveSurfer initialization failed:", e);
            waveformContainer.textContent = "WaveSurfer could not initialize. Audio playback and waveform visualization disabled.";
            wavesurfer = null;
            playPauseBtn.disabled = true;
            showStatus("❌ Waveform initialization failed.", "error");
        }
    }

    // --- Initial Setup ---
    initializeWaveSurfer(); // Initialize WaveSurfer when DOM is ready
    resetApp(false); // Set initial state to idle and clear everything
    // --- End Initial Setup ---

});