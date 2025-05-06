document.addEventListener("DOMContentLoaded", function () {
  // =====================
  // API Checks & Initial Debugging
  // =====================
  const hasMediaDevices = !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia;
  const hasMediaRecorder = !!window.MediaRecorder;
  // Use window.SpeechRecognition or window.webkitSpeechRecognition for broader compatibility
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasSpeechRecognition = !!SpeechRecognition;
  const hasCanvasCaptureStream = !!HTMLCanvasElement.prototype.captureStream;
  // Use window.AudioContext or window.webkitAudioContext
  const hasAudioContext = !!(window.AudioContext || window.webkitAudioContext);

  console.log("Initial API Checks (these determine if recording *can* work):");
  console.log(`  - Page is HTTPS or localhost: ${window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'}`);
  console.log(`  - hasMediaDevices (mic access API): ${hasMediaDevices}`);
  console.log(`  - hasMediaRecorder (recording API): ${hasMediaRecorder}`);
  console.log(`  - hasSpeechRecognition (transcript API): ${hasSpeechRecognition ? 'Yes' : 'No (Transcript will be manual)'}`);
  console.log(`  - hasCanvasCaptureStream (video API): ${hasCanvasCaptureStream}`);
  console.log(`  - hasAudioContext (audio processing API): ${hasAudioContext}`);


  // =====================
  // DOM Elements
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
  // Adjusted selector based on HTML provided
  const recordingIndicator = document.getElementById("recording-indicator");
  const audioDurationSpan = document.getElementById("audio-duration");
  const statusDiv = document.getElementById("status");
  const waveformContainer = document.getElementById("waveform");

  const audioFileNameInput = document.getElementById("audioFileNameInput");
  const videoFileNameInput = document.getElementById("videoFileNameInput");
  const transcriptFileNameInput = document.getElementById("transcriptFileNameInput");

  // =====================
  // Global State Variables
  // =====================
  let mediaRecorder; // The MediaRecorder instance
  let audioChunks = []; // Array to hold audio data chunks
  let recognition; // The SpeechRecognition instance
  let finalTranscript = ""; // Stores finalized speech recognition results
  // let interimTranscript = ""; // Could be added for separate interim display if needed
  let stream; // Holds the MediaStream from getUserMedia
  let audioBlob; // The final recorded audio Blob
  let audioUrl; // Object URL for the audioBlob (primarily for cleanup)
  let wavesurfer; // WaveSurfer instance
  let isRecording = false; // Flag indicating if recording is currently active
  let isProcessingStop = false; // Flag to prevent multiple stops during the stop sequence
  let supportedAudioType = ""; // MIME type used by MediaRecorder for the current recording
  let statusTimeoutId = null; // ID for the status message timeout

  // Variables for video generation audio context
  let audioContextForVideo = null;
  let bufferSourceNodeForVideo = null; // Node to play audio buffer
  let destinationNodeForVideo = null; // Destination node to get audio stream
  let canvasAnimationId = null; // ID for requestAnimationFrame for canvas animation


  // =====================
  // Constants
  // =====================
  const MIN_RECORDING_BLOB_SIZE = 100; // Minimum size for a valid audio blob (bytes)
  const STATUS_MESSAGE_DURATION = 4000; // How long temporary status messages display (ms)
  const DEFAULT_AUDIO_FILENAME_BASE = "recorded_audio";
  const DEFAULT_VIDEO_FILENAME_BASE = "generated_video";
  const DEFAULT_TRANSCRIPT_FILENAME_BASE = "transcript";


  // =====================
  // Utility Functions
  // =====================
  // Formats time in seconds to M:SS format
  function formatTime(seconds) {
      const minutes = Math.floor(seconds / 60);
      const remaining = Math.floor(seconds % 60);
      return `${minutes}:${remaining.toString().padStart(2, "0")}`;
  }

  // Sanitizes input text to be safe for filenames and appends extension
  function getSanitizedFilename(inputElement, defaultBaseName, extension) {
      let filename = defaultBaseName;
      // Use input value if element exists and has a non-empty value
      if (inputElement && inputElement.value.trim()) {
          filename = inputElement.value.trim();
      }
      // Remove existing extension if present
      filename = filename.replace(/\.[^/.]+$/, "");
      // Sanitize further: remove characters invalid or problematic for filenames
      filename = filename.replace(/[/\\?%*:|"<>]/g, '').replace(/\s+/g, '_'); // Replace spaces with underscores
      // Limit length? Optional, but good practice for very long inputs
      // filename = filename.substring(0, 100);
      return filename + extension;
  }

  // Triggers a download of a blob
  function downloadBlob(blob, filename) {
      if (!blob) {
          alert("Error: No data available for download.");
          return;
      }
      try {
          // Create a temporary URL for the blob
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.style.display = "none"; // Hide the anchor element
          a.href = url;
          a.download = filename; // Set the download filename
          document.body.appendChild(a); // Append to body
          a.click(); // Simulate a click
          document.body.removeChild(a); // Clean up the element
          // Revoke the object URL shortly after triggering the download
          // Using setTimeout is generally safe as the browser copies the data
          setTimeout(() => URL.revokeObjectURL(url), 100);
          showStatus(`Download started: ${filename}`, "success", 2000);
      } catch (e) {
          console.error("Download failed:", e);
          alert(`Download failed:\n${e.message}`); // Use alert for critical download failure
          showStatus("❌ Download failed.", "error"); // Show status message as well
      }
  }

  // Displays status messages in the dedicated div
  function showStatus(message, type = "info", duration = STATUS_MESSAGE_DURATION) {
      console.log(`Status (${type}): ${message}`); // Log to console for debugging
      // Clear any existing timeout to prevent premature clearing
      if (statusTimeoutId) clearTimeout(statusTimeoutId);
      statusTimeoutId = null;
      // Update status div content and class
      statusDiv.textContent = message;
      // Ensure 'visible' class is added to trigger opacity transition
      statusDiv.className = `status visible ${type}`;
      // Set timeout to clear message if duration is > 0
      if (duration > 0) {
          statusTimeoutId = setTimeout(() => {
              // Check if the current message is still the one we set the timeout for
              // Prevents clearing a new message that appeared within the duration
              if (statusDiv.textContent === message) {
                  statusDiv.className = "status info"; // Revert to default state
                  statusDiv.textContent = ""; // Clear text
              }
          }, duration);
      }
  }


  // Updates the disabled state and text/placeholder of buttons and UI elements
  function updateButtonStates(state) {
      // Define states for clarity
      const isIdle = state === "idle";
      const isRecordingState = state === "recording";
      const isRecorded = state === "recorded"; // Implies audioBlob exists and is processed/ready
      const isProcessing = state === "processing"; // E.g., waveform loading, video generating

      // --- Button States ---
      // Start button is only enabled when idle and not currently processing a stop
      startBtn.disabled = !isIdle || isProcessing;

      // Stop button is enabled only when actively recording and not already processing a stop
      stopBtn.disabled = !isRecordingState || isProcessingStop;

      // Reset button requires either recorded audio or transcript and not be recording/processing
      resetBtn.disabled = (isIdle && !audioBlob && !subtitle.value.trim()) || isProcessing || isRecordingState;
      // Clear UI button requires recorded audio OR transcript and not be recording/processing
      clearUIBtn.disabled = (isIdle && !audioBlob && !subtitle.value.trim()) || isProcessing || isRecordingState;

      // Play/Pause requires recorded audio and a ready wavesurfer instance
      playPauseBtn.disabled = !isRecorded || isProcessing || !wavesurfer || !(wavesurfer && wavesurfer.isReady);
      // Download requires recorded audio
      downloadBtn.disabled = !isRecorded || isProcessing || !audioBlob;
      // Export requires a non-empty transcript
      exportBtn.disabled = !isRecorded || isProcessing || !subtitle.value.trim();
      // Video requires recorded audio, transcript, and browser features
      videoBtn.disabled = !isRecorded || isProcessing || !audioBlob || !subtitle.value.trim() || !hasCanvasCaptureStream || !hasAudioContext;

      // --- UI Element States ---
      // Subtitle textarea is read-only during recording and processing states
      subtitle.readOnly = isRecordingState || isProcessing;

      // Recording indicator visibility
      // Add/remove class for CSS animation control
      if (isRecordingState) {
           recordingIndicator.classList.add('visible');
      } else {
           recordingIndicator.classList.remove('visible');
      }
      // Display property is handled by CSS based on .visible, but ensure it's block when needed
       recordingIndicator.style.display = isRecordingState ? "flex" : "none"; // Use flex for centering dot+text

      // --- Status Message and Placeholder Updates ---
      // Status messages for key states (Processing, Recording, Idle)
      if (isProcessing) {
          showStatus("⏳ Processing... Please wait.", "processing", 0); // Sticky status
      } else if (isRecordingState) {
          showStatus("🔴 Recording...", "info", 0); // Sticky status
      } else if (isIdle) {
          showStatus("Ready. Click 'Start Recording' to begin.", "info"); // Info status with duration
          // Update subtitle placeholder based on core API and context availability
          const canRecord = hasMediaDevices && hasMediaRecorder && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
          if (canRecord) {
               subtitle.placeholder = hasSpeechRecognition ? 'Click "Start Recording" to begin speaking.' : 'Click "Start Recording" to record audio.';
          } else {
               subtitle.placeholder = "⚠️ Recording may not be possible (check HTTPS/localhost & browser features). Click Start to verify.";
          }
      }
       // For 'recorded' state, status is typically set by the onstop/ready handlers (e.g., "Audio processed", "Waveform unavailable")
  }

  // Resets the application state and UI. Optionally preserves the recorded audio data and transcript.
  function resetApp(preserveAudio = false) {
      console.log("Resetting application. Preserve audio:", preserveAudio);
      isRecording = false;
      isProcessingStop = false;

      // Stop MediaRecorder if active and clear reference
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
          try { mediaRecorder.stop(); } catch (e) { console.warn("Error stopping MediaRecorder during reset:", e); }
      }
      mediaRecorder = null;

      // Abort Speech Recognition if active
      if (recognition && typeof recognition.abort === "function" && recognition.state !== 'idle') {
          try { recognition.abort(); } catch (e) { console.warn("Error aborting SpeechRecognition during reset:", e); }
      }
      // Note: The 'recognition' instance itself is kept for potential reuse, just stopped/aborted.


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
      const canRecord = hasMediaDevices && hasMediaRecorder && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
       if (canRecord) {
          subtitle.placeholder = hasSpeechRecognition ? 'Click "Start Recording" to begin speaking.' : 'Click "Start Recording" to record audio.';
       } else {
          subtitle.placeholder = "⚠️ Recording may not be possible (check HTTPS/localhost & browser features). Click Start to verify.";
       }


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
               console.log("WaveSurfer reset.");
          } catch (e) { console.warn("Error resetting WaveSurfer:", e); }
          // Note: The wavesurfer instance itself is generally preserved unless a critical error occurred during initialization/loading.
      }

      // Clean up video generation audio context resources
      if (bufferSourceNodeForVideo) { try { bufferSourceNodeForVideo.stop(); bufferSourceNodeForVideo.disconnect(); } catch (e) {console.warn("Error stopping/disconnecting bufferSourceNodeForVideo:", e);} bufferSourceNodeForVideo = null; }
      if (destinationNodeForVideo) { try { destinationNodeForVideo.disconnect(); } catch (e) {console.warn("Error disconnecting destinationNodeForVideo:", e);} destinationNodeForVideo = null; }
      // Close the AudioContext gracefully if it's not already closed
      if (audioContextForVideo && audioContextForVideo.state !== 'closed') {
          console.log("Attempting to close AudioContext for video.");
          audioContextForVideo.close().then(() => {
              audioContextForVideo = null;
              console.log("AudioContext for video closed.");
          }).catch(e => {
              console.warn("Error closing AudioContext for video:", e);
              audioContextForVideo = null; // Still clear the reference
          });
      } else {
           audioContextForVideo = null; // Ensure it's null if it was already closed or null
      }

      // Cancel canvas animation frame for video generation
      if (canvasAnimationId) { cancelAnimationFrame(canvasAnimationId); canvasAnimationId = null; }

      // Clear any pending status message timeout
      if (statusTimeoutId) { clearTimeout(statusTimeoutId); statusTimeoutId = null; }
       // Clear the status message display text and class
       statusDiv.className = "status info"; // Revert to default class
       statusDiv.textContent = ""; // Clear text


      // Update button states based on whether audio was preserved
      showStatus("Application reset.", "info", 2000);
      updateButtonStates(audioBlob && preserveAudio ? "recorded" : "idle");
  }

  // Starts the audio recording process
  async function startRecording() {
      // === Initial API and context checks ===
      // Check if core recording APIs are supported by the browser
      if (!hasMediaDevices || !hasMediaRecorder) {
          alert("Recording is not possible:\nRequired browser features (MediaDevices or MediaRecorder API) are not available or not supported.\n\nPlease use a modern browser (like Chrome, Firefox, Edge, Safari).");
          console.error("Start recording aborted: MediaDevices or MediaRecorder API not available.");
          return; // Stop the start process
      }
      // Check if the page is served over HTTPS or localhost, required for microphone access
      if (!(window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
          alert("Recording is not possible:\nMicrophone access requires a secure connection (HTTPS) or for the page to be served from localhost.");
          console.error("Start recording aborted: Not a secure context.");
          return; // Stop the start process
      }
      // === END Initial API Checks ===

      console.log("Attempting to start recording...");
      // Prevent starting if already recording or processing a stop
      if (isRecording || isProcessingStop) {
          showStatus("Cannot start recording: Already recording or processing.", "warning");
          return; // Stop the start process
      }

      resetApp(false); // Perform a full reset before starting a new recording to ensure a clean state

      isRecording = true; // Set state flag early

      // --- Get Microphone Access ---
      try {
          // Request access to the user's microphone
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          console.log("Microphone access granted.");
      } catch (err) {
          console.error("Microphone error:", err);
          // Provide a user-friendly alert if mic access is denied or fails
          alert(`Microphone Access Denied or Error:\n${err.message}\n\nPlease grant microphone permission in your browser settings and try again.`);
          isRecording = false; // Reset state flag
          updateButtonStates("idle"); // Update UI to reflect idle state
          return; // Stop the start process
      }
      // --- End Get Microphone Access ---


      // --- Determine Supported Audio Format ---
      // Define a list of preferred audio MIME types and find the first supported one
      // Prioritize webm/opus as it's generally well-supported for recording AND decoding (WaveSurfer/Web Audio API)
      const mimeTypes = [
          "audio/webm;codecs=opus", // High quality, good compatibility
          "audio/webm", // Generic webm
          "audio/mp4;codecs=mp4a.40.2", // AAC in MP4
          "audio/mp4", // Generic MP4
          "audio/mpeg", // MP3 (support varies for recording)
          "audio/ogg;codecs=opus", // Opus in Ogg
          "audio/ogg", // Generic Ogg
          "audio/wav" // WAV (simple, large files, support varies for recording)
      ];
      supportedAudioType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));

      if (!supportedAudioType) {
          console.error("No supported MIME type for audio recording found.");
          // Alert the user if no suitable format is supported
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
          // Create the MediaRecorder instance with the selected stream and MIME type
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
      // Collect data chunks as they become available
      mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
              audioChunks.push(event.data);
               console.log(`Data available: ${event.data.size} bytes`);
          }
      };

      // Process the recorded audio when the recording stops
      mediaRecorder.onstop = () => {
          console.log("MediaRecorder onstop triggered.");
          isRecording = false;
          isProcessingStop = false; // Processing of recorded data is now starting

          // Ensure media stream tracks are stopped after recording stops
          stream?.getTracks().forEach((track) => track.stop());
          stream = null; // Clear stream reference

          // Check if any audio data was captured
          if (audioChunks.length === 0) {
              console.warn("No audio data captured.");
              showStatus("⚠️ Recording failed: No audio data.", "warning");
              resetApp(false); // Reset completely if no data was captured
              return;
          }

          // --- Create Audio Blob ---
          try {
              // Combine chunks into a single audio blob
              audioBlob = new Blob(audioChunks, { type: supportedAudioType });
              console.log(`Audio Blob created: ${audioBlob.size} bytes, Type: ${audioBlob.type}`);
              audioChunks = []; // Clear chunks array after creating blob

              // Check if the blob size is above a minimum threshold
              if (audioBlob.size < MIN_RECORDING_BLOB_SIZE) {
                  console.warn("Audio blob size is too small.", audioBlob.size);
                  showStatus("Recording too short.", "warning");
                  resetApp(false); // Reset completely if recording was too short
                  return;
              }
          } catch (e) {
              console.error("Error creating audio blob:", e);
              alert(`Audio Processing Error after recording:\n${e.message}`);
              resetApp(false); // Reset completely on blob creation error
              return; // Stop the processing sequence
          }
          // --- End Create Audio Blob ---


          // --- Process Audio Blob (Waveform/Playback) ---
          // Check if WaveSurfer instance is available
          if (wavesurfer) {
              updateButtonStates("processing"); // Indicate processing state
              showStatus("⏳ Processing audio waveform...", "processing", 0); // Sticky processing status
              try {
                  // Load the audio blob into WaveSurfer
                  // Note: This is an asynchronous operation. Errors are handled by wavesurfer.on('error').
                  wavesurfer.loadBlob(audioBlob);
                  console.log("wavesurfer.loadBlob called.");
                  // UI state updates (to 'recorded') happen in wavesurfer.on('ready') or wavesurfer.on('error')
              } catch (loadError) {
                  // This catch block only catches SYNCHRONOUS errors when calling loadBlob(),
                  // not asynchronous errors that occur during the actual audio decoding/loading.
                  console.error("Synchronous error during wavesurfer.loadBlob call:", loadError);
                  // If a sync error occurs, WaveSurfer might be in a bad state, so destroy it.
                  alert(`Waveform Load Error (sync): ${loadError.message}`);
                  if (wavesurfer) {
                      try { wavesurfer.destroy(); } catch(e) { console.warn("Error destroying wavesurfer after sync error:", e); }
                      wavesurfer = null; // Ensure the reference is nullified
                  }
                  resetApp(true); // Reset UI state but try to preserve the audio blob
              }
          } else {
              // Fallback path if WaveSurfer was not initialized successfully
              console.warn("WaveSurfer instance not available. Falling back to basic audio info.");
              updateButtonStates("recorded"); // Go directly to recorded state
              showStatus("✅ Audio recorded. Waveform unavailable.", "success"); // Inform user
              subtitle.readOnly = false; // Allow editing transcript
              subtitle.placeholder = "Transcription ready. Edit if needed.";

              // Attempt to get duration using a temporary HTML audio element
              const tempAudio = document.createElement('audio');
              // Event handler for successful metadata loading
              tempAudio.onloadedmetadata = () => {
                  console.log("Temporary audio element loaded metadata.");
                  audioDurationSpan.textContent = formatTime(tempAudio.duration); // Display duration
                  URL.revokeObjectURL(tempAudio.src); // Clean up object URL after use
              };
              // Event handler for errors during loading metadata
              tempAudio.onerror = (e) => {
                  console.error("Temporary audio element error:", e);
                  showStatus("⚠️ Audio recorded, but playback/duration failed (temp element).", "warning");
                  if (tempAudio.src) URL.revokeObjectURL(tempAudio.src); // Clean up object URL even on error
              };
              // Event handler for aborts during loading
              tempAudio.onabort = () => {
                  console.warn("Temporary audio element aborted loading.");
                  if (tempAudio.src) URL.revokeObjectURL(tempAudio.src); // Clean up object URL
              };
              // Set the source of the temporary audio element using a blob URL
              tempAudio.src = URL.createObjectURL(audioBlob);
              console.log("Attempting to load blob into temporary audio element.");
          }
          // --- End Process Audio Blob ---
      };

      // Handle errors that occur during the recording session itself
      mediaRecorder.onerror = (event) => {
          console.error("MediaRecorder error during session:", event.error);
          showStatus(`❌ Recording Error: ${event.error.name || 'Unknown'}`, "error", 0); // Sticky error status
          // Use a small timeout to allow the 'onstop' event to potentially fire first if the error
          // happened very close to the stop request. Then, force a reset if still needed.
          setTimeout(() => {
               // Only reset if we are still considered to be in a recording or processing stop state
               if (isRecording || isProcessingStop) {
                  console.warn("Forcing reset after MediaRecorder error timeout.");
                  resetApp(false); // Reset to a clean state on critical error
               }
          }, 50); // Short delay (e.g., 50 milliseconds)
      };
       // --- End MediaRecorder Event Handlers ---


      // --- Speech Recognition Setup and Start ---
      // Check if Speech Recognition API is supported
      if (hasSpeechRecognition) {
          // Initialize Speech Recognition instance if it doesn't exist
          if (!recognition) {
              recognition = new SpeechRecognition();
              recognition.lang = "en-US"; // Set language (adjust as needed)
              recognition.continuous = true; // Keep listening until explicitly stopped or error
              recognition.interimResults = true; // Provide results while the user is speaking
              recognition.maxAlternatives = 1; // Only return the most likely transcription

              recognition.onstart = () => {
                   console.log("SpeechRecognition started.");
                   // Placeholder is updated by updateButtonStates
              };

              recognition.onresult = (event) => {
                  let interim = ""; // To hold current, non-finalized speech
                  let currentFinal = ""; // To hold new finalized speech in this event

                  // Iterate through results
                  for (let i = event.resultIndex; i < event.results.length; i++) {
                      const result = event.results[i][0]; // Get the top alternative (index 0)
                      const transcript = result.transcript;

                      if (event.results[i].isFinal) {
                          // If the result is final, append it to the total final transcript
                          currentFinal += transcript.trim() + " ";
                      } else {
                          // If the result is interim, hold it separately
                          interim += transcript;
                      }
                  }
                  // Append any new final results to the global finalTranscript
                  if (currentFinal) {
                      finalTranscript += currentFinal;
                      // Optional: Log confidence? result.confidence (result.confidence is per alternative)
                      // console.log("Final chunk confidence:", event.results[event.results.length - 1][0].confidence);
                  }
                  // Update the textarea with the accumulated final transcript plus the current interim results
                  subtitle.value = (finalTranscript + interim).trim();
                  // Auto-scroll the textarea to show the latest transcription
                  subtitle.scrollTop = subtitle.scrollHeight;
              };

              recognition.onerror = (e) => {
                   console.error("SpeechRecognition error:", e);
                  // Handle specific errors if needed (e.g., permission denied, network, no-speech)
                  // Ignore common 'no-speech' and 'aborted' errors unless debugging
                  if (!["no-speech", "aborted", "audio-capture"].includes(e.error)) {
                      showStatus(`⚠️ Speech Rec Error: ${e.error}.`, "warning");
                      // You might add an alert for permission errors if the browser doesn't show one clearly:
                      // if (e.error === 'not-allowed') { alert("Speech recognition permission denied. Check browser settings."); }
                  } else {
                      // Log expected errors at a lower level or ignore in production
                      // console.log(`SpeechRecognition expected error: ${e.error}`);
                  }
              };

              recognition.onend = () => {
                   console.log("SpeechRecognition ended.");
                  // Ensure the final result is captured and displayed one last time
                  subtitle.value = finalTranscript.trim();
                  // Note: Speech recognition typically stops automatically when the audio stream ends (MediaRecorder stops).
                  // A manual stop is also called in stopRecording() for robustness.
              };
          }
          // Attempt to start speech recognition
          try {
              // Check the state before calling start to avoid InvalidStateError in some browsers
               if (recognition && recognition.state !== 'recognizing' && typeof recognition.start === 'function') {
                  recognition.start();
                   console.log("SpeechRecognition start attempt.");
               } else if (recognition && recognition.state === 'recognizing') {
                   console.log("SpeechRecognition already running.");
               } else {
                    console.warn("SpeechRecognition object not initialized or start method missing.");
               }
          } catch (e) {
               // Catch potential synchronous errors when calling start() (e.g., InvalidStateError if called too soon or state is wrong)
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
      // Start the MediaRecorder after successful stream acquisition and setup
      try {
          mediaRecorder.start();
          console.log("MediaRecorder started successfully.");
          // Update UI state now that recording has successfully begun
          updateButtonStates("recording");
      } catch (e) {
          console.error("Critical Error: Failed to start MediaRecorder:", e);
          alert(`Critical Error: Failed to start MediaRecorder.\n${e.message}`);
          // Clean up resources if MediaRecorder start fails immediately
          stream?.getTracks().forEach((track) => track.stop());
          stream = null;
           // Abort Speech Recognition if it was started but recording failed
          if (recognition && typeof recognition.abort === "function") {
              try { recognition.abort(); } catch (err) { console.warn("Error aborting SR after MR start failure:", err); }
          }
          isRecording = false; updateButtonStates("idle"); // Revert UI state
      }
       // --- End Start MediaRecorder ---
  }

  // Stops the audio recording process
  function stopRecording() {
      // Prevent stopping if not currently recording or if the stop process is already underway
      if (!isRecording || isProcessingStop) {
           console.log("Stop requested, but not recording or already processing stop.");
          return;
      }
      console.log("Attempting to stop recording...");
      isProcessingStop = true; // Set flag to indicate stop process has begun
      updateButtonStates("processing"); // Update UI state to processing
      showStatus("⏳ Stopping recording...", "processing", 0); // Show processing status

      // Attempt to stop Speech Recognition if it's active
      // Check hasSpeechRecognition just in case, and state should be 'recognizing'
      if (hasSpeechRecognition && recognition && typeof recognition.stop === 'function' && recognition.state === 'recognizing') {
          try {
               recognition.stop();
               console.log("SpeechRecognition stop requested.");
          } catch (e) {
               console.warn("Error stopping SpeechRecognition:", e);
               // Continue with MediaRecorder stop even if SR stop fails
          }
      }

      // Attempt to stop MediaRecorder
      // Check if MediaRecorder exists and is in a state that can be stopped
      if (mediaRecorder && (mediaRecorder.state === "recording" || mediaRecorder.state === "paused")) {
          try {
              mediaRecorder.stop();
               console.log("MediaRecorder stop requested.");
              // The asynchronous 'onstop' event handler will be triggered after this call
              // to handle the processing of the recorded data.
          } catch (e) {
              // Handle errors that occur specifically when trying to call mediaRecorder.stop()
              console.error("Error calling mediaRecorder.stop():", e);
              // Show error message, but don't rely on onstop event firing.
              showStatus(`❌ Error stopping recording: ${e.message}`, "error");
              // Implement a fallback force-reset after a short delay
              // This helps if the stop() call itself failed and the onstop event won't fire.
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
      // Check for necessary browser APIs for video generation
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
      const canvas = document.createElement("canvas"); // Create an offscreen canvas element
      const ctx = canvas.getContext("2d"); // Get the 2D drawing context

      // Define canvas dimensions (vertical format)
      const width = 720;
      const height = 1280;
      canvas.width = width;
      canvas.height = height;

      // --- Canvas Drawing Properties ---
      // Get colors from CSS variables defined in :root
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-light").trim() || "#ffffff"; // Text color
      const fontSize = 40; // Font size for transcription
      const textLineHeight = 50; // Line height for wrapped text
      // Set font style - ensure the font is loaded via CSS/HTML
      ctx.font = `bold ${fontSize}px 'Archivo', sans-serif`;
      ctx.textAlign = "center"; // Center text horizontally
      ctx.textBaseline = "middle"; // Align text vertically based on middle
      const textPadding = width * 0.1; // Padding on the sides
      const maxWidth = width - 2 * textPadding; // Maximum width for text line
      const centerY = height / 2; // Vertical center of the canvas
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue("--bg-dark").trim() || "#222222"; // Background color
      // --- End Canvas Drawing Properties ---


      // --- Text Wrapping Function ---
      // Helper function to draw text with word wrapping
      function drawWrappedText(context, text, x, y, textMaxWidth, lineHeight) {
          const words = text.split(" ");
          let line = "";
          let lines = [];

          // Simple word wrapping algorithm
          for (let n = 0; n < words.length; n++) {
              // Build a test line with the next word
              const testLine = line + words[n] + (n < words.length - 1 ? " " : "");
              // Measure the width of the test line
              const testWidth = context.measureText(testLine).width;

              // If the test line is too wide and it's not the very first word,
              // push the current line and start a new line with the current word.
              if (testWidth > textMaxWidth && n > 0) {
                  lines.push(line.trim()); // Add the completed line
                  line = words[n] + (n < words.length - 1 ? " " : ""); // Start new line
              } else {
                  // Otherwise, add the word to the current line
                  line = testLine;
              }
          }
          // Add the last line
          if (line.trim() !== "") {
              lines.push(line.trim());
          }

          // --- Draw the Wrapped Lines ---
          // Calculate the starting Y position to center the block of text vertically
          const totalTextHeight = lines.length * lineHeight;
          let currentY = y - totalTextHeight / 2 + lineHeight / 2; // Adjust starting Y

          // Draw each line
          lines.forEach((singleLine) => {
              context.fillText(singleLine, x, currentY);
              currentY += lineHeight; // Move down for the next line
          });
           return lines.length; // Return number of lines drawn (optional)
      }
      // --- End Text Wrapping Function ---


      // --- Canvas Animation Loop ---
      // Function to draw a single frame of the canvas animation
      function animateCanvas() {
          // Clear canvas with the background color
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, width, height);

          // Draw the current transcript text, wrapped and centered
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-light").trim() || "#ffffff";
          drawWrappedText(ctx, currentTranscript, width / 2, centerY, maxWidth, textLineHeight);

          // Request the next animation frame (creates a loop)
          canvasAnimationId = requestAnimationFrame(animateCanvas);
      }

      // Start the canvas animation loop. This is necessary for captureStream to get frames.
      animateCanvas();
       console.log("Canvas animation started.");
      // --- End Canvas Animation Loop ---


      // --- Get Video Stream from Canvas ---
      let canvasStream;
      try {
          // Capture a video stream from the canvas at 30 frames per second
          canvasStream = canvas.captureStream(30);
          // Verify that a stream was obtained and has video tracks
          if (!canvasStream || canvasStream.getVideoTracks().length === 0) {
              throw new Error("Canvas captureStream failed or returned no video tracks.");
          }
           console.log("Canvas captureStream obtained.");
      } catch (e) {
          console.error("Canvas captureStream error:", e);
          showStatus(`❌ Video Error (Canvas Capture): ${e.message}`, "error", 0);
          if (canvasAnimationId) cancelAnimationFrame(canvasAnimationId); canvasAnimationId = null; // Clean up animation
          // Stop any tracks that might have been created
          canvasStream?.getTracks().forEach(track => track.stop());
          updateButtonStates("recorded"); // Return to recorded state
          return; // Stop video generation process
      }
      // --- End Get Video Stream from Canvas ---


      // --- Get Audio Stream from Blob using Web Audio API ---
      let audioStreamFromBlob;
      let audioDuration = 0;
      try {
          // Close any existing AudioContext created for a previous video generation attempt
          if (audioContextForVideo && audioContextForVideo.state !== 'closed') {
              console.log("Closing existing AudioContext for video.");
              await audioContextForVideo.close().catch(e => console.warn("Error closing previous AudioContext:", e));
          }
          // Create a new AudioContext
          audioContextForVideo = new (window.AudioContext || window.webkitAudioContext)();
          // Create a MediaStreamDestination node that will output the audio as a stream
          destinationNodeForVideo = audioContextForVideo.createMediaStreamDestination();
          // Get the MediaStream from the destination node
          audioStreamFromBlob = destinationNodeForVideo.stream;

          // Decode the audio blob data into an AudioBuffer asynchronously
          const arrayBuffer = await audioBlob.arrayBuffer(); // Get blob data as ArrayBuffer
          const audioBufferDecoded = await audioContextForVideo.decodeAudioData(arrayBuffer); // Decode the audio data
           audioDuration = audioBufferDecoded.duration; // Get the duration from the decoded audio buffer
           console.log(`Audio blob decoded, duration: ${audioDuration} seconds`);

          // Create an AudioBufferSourceNode to play the decoded audio buffer
          bufferSourceNodeForVideo = audioContextForVideo.createBufferSource();
          bufferSourceNodeForVideo.buffer = audioBufferDecoded; // Set the decoded audio data as the source
          // Connect the source node to the MediaStreamDestination node
          bufferSourceNodeForVideo.connect(destinationNodeForVideo);

           // Add an onended event listener to the audio source node
           bufferSourceNodeForVideo.onended = () => {
               console.log("AudioBufferSourceNode finished playing.");
               // When the audio finishes, stop the video recorder to sync video length to audio.
               // Check state to prevent errors if it's already stopped/stopping.
               if (videoRecorder && videoRecorder.state === "recording") {
                   console.log("Stopping video recorder because audio finished.");
                   try { videoRecorder.stop(); } catch (e) { console.warn("Error stopping video recorder from audio onended:", e); }
               } else {
                   console.log("Video recorder not in 'recording' state when audio finished.");
               }
           };


      } catch (e) {
          console.error("Audio setup from blob error:", e);
          showStatus(`❌ Video Error (Audio Setup): ${e.message}`, "error", 0);
          if (canvasAnimationId) cancelAnimationFrame(canvasAnimationId); canvasAnimationId = null; // Clean up animation
          canvasStream?.getTracks().forEach(track => track.stop()); // Stop canvas stream tracks
          // Clean up Web Audio API resources
          bufferSourceNodeForVideo?.disconnect(); // Disconnect if connected
          try { bufferSourceNodeForVideo?.stop(); } catch (err) { console.warn("Error stopping bufferSourceNode during audio setup error:", err); } // Stop if it was started
          destinationNodeForVideo?.disconnect(); // Disconnect destination
          if (audioContextForVideo && audioContextForVideo.state !== 'closed') {
               audioContextForVideo.close().catch(err => console.warn("Error closing audio context after setup error:", err));
          }
          // Nullify references
           audioContextForVideo = null; bufferSourceNodeForVideo = null; destinationNodeForVideo = null;
          updateButtonStates("recorded"); // Return to recorded state
          return; // Stop video generation process
      }
      // --- End Get Audio Stream from Blob ---


      // --- Combine Streams and Record Video ---
      // Determine the best supported video MIME type for recording
      // Prefer MP4 with common codecs if supported, fallback to WebM
      let videoMimeType = "video/webm"; // Default fallback
      const preferredVideoMimeTypes = [
          "video/mp4;codecs=avc1.42E01E,mp4a.40.2", // H.264 (AVC) + AAC
          "video/mp4", // Generic MP4 (browser picks codecs)
          "video/webm;codecs=vp9,opus", // VP9 + Opus (modern webm)
          "video/webm;codecs=vp8,vorbis", // VP8 + Vorbis (older webm)
          "video/webm" // Generic WebM
      ];
      // Find the first supported MIME type in the preferred list
      videoMimeType = preferredVideoMimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
      console.log(`Using video output MIME type: ${videoMimeType}`);

      // Determine the file extension based on the selected MIME type
      const videoFileExtension = videoMimeType.includes("mp4") ? ".mp4" : ".webm";

      const videoChunks = []; // Array to hold video data chunks

      // Combine the video track from the canvas stream and the audio track from the blob stream
      const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioStreamFromBlob.getAudioTracks()]);

      let videoRecorder;
      try {
          // Create the MediaRecorder instance for the combined stream
          videoRecorder = new MediaRecorder(combinedStream, { mimeType: videoMimeType });
           console.log("Video MediaRecorder initialized.");
      } catch (e) {
          console.error("Video MediaRecorder initialization error:", e);
          showStatus(`❌ Video Error (Recorder Setup): ${e.message}`, "error", 0);
          if (canvasAnimationId) cancelAnimationFrame(canvasAnimationId); canvasAnimationId = null; // Clean up animation
          combinedStream.getTracks().forEach(track => track.stop()); // Stop combined stream tracks
           // Clean up Web Audio API resources
          bufferSourceNodeForVideo?.disconnect();
          try { bufferSourceNodeForVideo?.stop(); } catch (err) { console.warn("Error stopping bufferSourceNode during recorder init error:", err); }
          destinationNodeForVideo?.disconnect();
          if (audioContextForVideo && audioContextForVideo.state !== 'closed') {
               audioContextForVideo.close().catch(err => console.warn("Error closing audio context after recorder init error:", err));
          }
          audioContextForVideo = null; bufferSourceNodeForVideo = null; destinationNodeForVideo = null;

          updateButtonStates("recorded"); // Return to recorded state
          return; // Stop video generation process
      }

      // --- Video Recorder Event Handlers ---
      // Collect video data chunks as they become available
      videoRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
              videoChunks.push(e.data);
               console.log(`Video data available: ${e.data.size} bytes`);
          }
      };

      // Process the recorded video when the recording stops
      videoRecorder.onstop = () => {
          console.log("VideoRecorder onstop triggered.");
          // Clean up resources after recording stops
          if (canvasAnimationId) cancelAnimationFrame(canvasAnimationId); canvasAnimationId = null; // Stop canvas animation
          combinedStream.getTracks().forEach(track => track.stop()); // Stop the combined stream tracks

          // Ensure Web Audio API resources are stopped and closed
          bufferSourceNodeForVideo?.disconnect(); // Disconnect audio source
          try { bufferSourceNodeForVideo?.stop(); } catch (e) { console.warn("Error stopping buffer source node onstop:", e); } // Stop audio source
          destinationNodeForVideo?.disconnect(); // Disconnect audio destination

          if (audioContextForVideo && audioContextForVideo.state !== 'closed') {
               console.log("Closing AudioContext for video onstop.");
               audioContextForVideo.close().catch(e => console.warn("Error closing video audio context onstop:", e));
          }
          // Nullify references
          audioContextForVideo = null; bufferSourceNodeForVideo = null; destinationNodeForVideo = null;


          if (videoChunks.length === 0) {
              console.warn("No video data captured during recording.");
              showStatus("❌ Video generation failed: No data captured.", "error"); // Error status
              updateButtonStates("recorded"); // Return to recorded state
              return;
          }

          // Create the final video blob from chunks
          const videoOutBlob = new Blob(videoChunks, { type: videoMimeType });
          console.log(`Video Blob created: ${videoOutBlob.size} bytes, Type: ${videoOutBlob.type}`);

          // Get the desired filename and trigger download
          const filename = getSanitizedFilename(videoFileNameInput, DEFAULT_VIDEO_FILENAME_BASE, videoFileExtension);
          downloadBlob(videoOutBlob, filename); // downloadBlob handles its own success/error status message

          // Status update to 'recorded' is handled after download confirmation
          updateButtonStates("recorded"); // Return to recorded state
      };

      // Handle errors that occur during the video recording session
      videoRecorder.onerror = (e) => {
          console.error("VideoRecorder error:", e);
          showStatus(`❌ Video Generation Error: ${e.error?.name || 'Unknown'}`, "error", 0); // Sticky error status

          // Clean up resources on error
          if (canvasAnimationId) cancelAnimationFrame(canvasAnimationId); canvasAnimationId = null; // Stop animation
          combinedStream.getTracks().forEach(track => track.stop()); // Stop stream tracks

           bufferSourceNodeForVideo?.disconnect(); // Disconnect audio source
           try { bufferSourceNodeForVideo?.stop(); } catch (err) { console.warn("Error stopping buffer source node on video error:", err); } // Stop audio source
          destinationNodeForVideo?.disconnect(); // Disconnect audio destination

          if (audioContextForVideo && audioContextForVideo.state !== 'closed') {
               console.log("Closing AudioContext for video on error.");
               audioContextForVideo.close().catch(err => console.warn("Error closing video audio context on error:", err));
          }
          // Nullify references
          audioContextForVideo = null; bufferSourceNodeForVideo = null; destinationNodeForVideo = null;

          updateButtonStates("recorded"); // Return to recorded state
      };
      // --- End Video Recorder Event Handlers ---


      // --- Start Audio Playback and Video Recording ---
      try {
           // Start the AudioBufferSourceNode to play the audio stream
           console.log("Starting audio source node for video.");
          bufferSourceNodeForVideo.start();

          // Start the Video MediaRecorder
           console.log("Starting video recorder.");
          videoRecorder.start();

          // Set a timeout to stop the video recorder after the audio duration plus a small buffer
          // This ensures the video length matches the audio length.
          // The 'onended' event on the audio source node is a more reliable trigger,
          // but this timeout acts as a safeguard in case 'onended' doesn't fire as expected.
          const stopTimeout = (audioDuration * 1000) + 500; // Add 500ms buffer
          console.log(`Scheduled video recorder stop via timeout in ${stopTimeout} ms.`);

          // Schedule the timeout to stop the video recorder
          setTimeout(() => {
              // Check if the recorder is still in the recording state before stopping
              if (videoRecorder && videoRecorder.state === "recording") {
                  console.log("Stopping video recorder via duration timeout.");
                  try { videoRecorder.stop(); } catch (e) { console.warn("Error stopping video recorder via timeout:", e); }
              } else {
                   console.log("Video recorder not in 'recording' state when timeout fired.");
              }
          }, stopTimeout);

      } catch (e) {
          // Handle errors that occur immediately when trying to start audio or video recording
          console.error("Error starting audio source node or video recorder:", e);
          showStatus(`❌ Failed to start video recording process: ${e.message}`, "error", 0);

           // Clean up resources on immediate start error
           if (canvasAnimationId) cancelAnimationFrame(canvasAnimationId); canvasAnimationId = null; // Stop animation
          combinedStream?.getTracks().forEach(track => track.stop()); // Ensure combined stream tracks are stopped

           bufferSourceNodeForVideo?.disconnect();
           try { bufferSourceNodeForVideo?.stop(); } catch (err) {} // Stop if it started successfully
          destinationNodeForVideo?.disconnect();
           if (audioContextForVideo && audioContextForVideo.state !== 'closed') {
               audioContextForVideo.close().catch(err => console.warn("Error closing audio context after start error:", err));
           }
           audioContextForVideo = null; bufferSourceNodeForVideo = null; destinationNodeForVideo = null;

          updateButtonStates("recorded"); // Return to recorded state
      }
       // --- End Combine Streams and Record Video ---
  }


  // =====================
  // Event Listeners
  // =====================
  // Event listener for the Start button
  startBtn.addEventListener("click", startRecording);
  // Event listener for the Stop button
  stopBtn.addEventListener("click", stopRecording);

  // Event listener for the Download Audio button
  downloadBtn.addEventListener("click", () => {
      // Check if an audio blob exists and its type is known
      if (audioBlob && supportedAudioType) {
          // Determine the correct file extension based on the actual recorded MIME type
          let extension = ".bin"; // Default fallback extension
          if (supportedAudioType.includes("mpeg") || supportedAudioType.includes("mp3")) extension = ".mp3";
          else if (supportedAudioType.includes("mp4")) extension = ".mp4";
          else if (supportedAudioType.includes("webm")) extension = ".webm";
          else if (supportedAudioType.includes("ogg")) extension = ".ogg";
          else if (supportedAudioType.includes("wav")) extension = ".wav";

          // Get the sanitized filename and trigger download
          const filename = getSanitizedFilename(audioFileNameInput, DEFAULT_AUDIO_FILENAME_BASE, extension);
          downloadBlob(audioBlob, filename); // Use the utility function
      } else if (!audioBlob) {
          // Handle case where no audio has been recorded
          showStatus("No audio to download.", "warning");
      } else {
          // Should not happen if recording succeeded, but good safeguard
          showStatus("Cannot determine audio file type for download.", "warning");
      }
  });

  // Event listener for the Export Transcription button
  exportBtn.addEventListener("click", () => {
      // Check if there is transcription text to export
      if (subtitle.value.trim()) {
          // Create a blob from the textarea content
          const blob = new Blob([subtitle.value], { type: "text/plain;charset=utf-8" });
          // Get the sanitized filename and trigger download
          const filename = getSanitizedFilename(transcriptFileNameInput, DEFAULT_TRANSCRIPT_FILENAME_BASE, ".txt");
          downloadBlob(blob, filename); // Use the utility function
      } else {
          // Handle case where transcript is empty
          showStatus("No transcript to export.", "warning");
      }
  });

  // Event listener for the Generate Video button
  videoBtn.addEventListener("click", generateVideo);

  // Event listener for the Reset Session button (full reset)
  resetBtn.addEventListener("click", () => {
      // Ask for confirmation before performing a full reset if there is data
      if (audioBlob || subtitle.value.trim()) {
          if (!confirm("Are you sure you want to reset? This will clear all recorded audio and transcript data.")) {
              return; // Stop the reset if user cancels
          }
      }
      resetApp(false); // Perform a full reset (clears audio and transcript)
  });

  // Event listener for the Clear Transcription button (partial reset)
  clearUIBtn.addEventListener("click", () => {
      // Ask for confirmation before clearing the transcript if it exists
      if (subtitle.value.trim()) {
           if (!confirm("Are you sure you want to clear the transcript?")) {
              return; // Stop if user cancels
           }
      }
      subtitle.value = ""; // Clear the textarea value
      finalTranscript = ""; // Clear the stored final transcript
      // interimTranscript = ""; // Clear interim if used separately
      subtitle.placeholder = "Transcription cleared. Audio data (if any) is preserved."; // Update placeholder
      // Update button states - this will enable/disable buttons based on whether audioBlob still exists
      updateButtonStates(audioBlob ? "recorded" : "idle");
      showStatus("Transcription cleared.", "info"); // Show status message
  });

  // Event listener for the Play/Pause button
  playPauseBtn.addEventListener("click", () => {
      // Check if WaveSurfer instance exists and is ready to play
      if (wavesurfer && wavesurfer.isReady) {
          wavesurfer.playPause(); // Toggle play/pause
      } else if (!wavesurfer) {
           // Handle case where WaveSurfer is not available
           showStatus("Waveform player not available.", "warning");
      } else { // wavesurfer exists but is not ready
           // Handle case where WaveSurfer is still loading/processing
           showStatus("Waveform is not ready yet. Please wait.", "warning");
      }
  });


  // =====================
  // Initialization
  // =====================
  // Initializes the WaveSurfer.js instance
  function initializeWaveSurfer() {
      // Check if WaveSurfer library is loaded (assuming it's included via a script tag)
      if (typeof WaveSurfer === "undefined") {
          waveformContainer.textContent = "WaveSurfer library not found. Audio playback and waveform visualization disabled.";
          playPauseBtn.disabled = true; // Disable playback button explicitly
          console.error("WaveSurfer library not found. Make sure wavesurfer.js is included.");
          return; // Stop initialization process
      }

      // Clear any previous content in the waveform container
      waveformContainer.innerHTML = '';
      // Create a new element specifically for WaveSurfer to render into
      const wavesurferElement = document.createElement('div');
      // Optional: Add styles to the wavesurfer element itself if needed
      // wavesurferElement.style.width = '100%';
      // wavesurferElement.style.height = '100%'; // Or a fixed height
      waveformContainer.appendChild(wavesurferElement); // Append the new element to the container

      try {
          // Create the WaveSurfer instance
          wavesurfer = WaveSurfer.create({
              container: wavesurferElement, // Use the created element as the container
              waveColor: getComputedStyle(document.documentElement).getPropertyValue('--wave-color').trim() || "#a8dadc", // Use CSS variable for wave color
              progressColor: getComputedStyle(document.documentElement).getPropertyValue('--wave-progress').trim() || "#ff6b6b", // Use CSS variable for progress color
              barWidth: 3, // Width of the waveform bars
              barRadius: 3, // Border radius of the bars
              height: 100, // Height of the waveform display area
              // Add optional parameters for better styling or performance
              responsive: true, // Make waveform responsive to container size
              hideScrollbar: true, // Hide horizontal scrollbar if waveform is long
              cursorColor: getComputedStyle(document.documentElement).getPropertyValue('--text-light').trim() || "#ffffff", // Color of the playback cursor
              cursorWidth: 1, // Width of the playback cursor
              // backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--wave-bg').trim() || "#1d3557", // Match container background (optional)
              // interact: true, // Allow seeking by clicking (default is true)
              // mediaControls: false, // Hide default HTML5 audio controls (not relevant here)
              // audioContext: (window.AudioContext || window.webkitAudioContext), // Could reuse app's context? No, let WaveSurfer manage its own for simplicity.
          });
          wavesurfer.isReady = false; // Custom property to track if audio has been loaded and processed

          // --- WaveSurfer Event Handlers ---
          // Event fires when audio is decoded and waveform is ready to be displayed/played
          wavesurfer.on("ready", () => {
              console.log("WaveSurfer ready event. Audio loaded and processed.");
              wavesurfer.isReady = true; // Set custom ready flag
              audioDurationSpan.textContent = formatTime(wavesurfer.getDuration()); // Display audio duration
              subtitle.readOnly = false; // Allow editing transcript after processing
              subtitle.placeholder = "Transcription ready. Edit if needed."; // Update placeholder
              updateButtonStates("recorded"); // Update UI state to 'recorded'
              showStatus("✅ Audio processed and waveform loaded.", "success"); // Success status
          });

          // Event fires when playback starts
          wavesurfer.on("play", () => {
              playPauseBtn.textContent = "Pause"; // Change button text to Pause
              console.log("WaveSurfer playback started.");
          });
          // Event fires when playback is paused
          wavesurfer.on("pause", () => {
              playPauseBtn.textContent = "Play"; // Change button text to Play
              console.log("WaveSurfer playback paused.");
          });
          // Event fires when playback reaches the end
          wavesurfer.on("finish", () => {
              playPauseBtn.textContent = "Play"; // Change button text back to Play
              wavesurfer.seekTo(0); // Return playback to the beginning
              console.log("WaveSurfer playback finished.");
          });

          // Event fires if an error occurs during loading, decoding, or playback
          wavesurfer.on("error", (err) => {
              console.error("WaveSurfer error:", err); // Log the specific error object
              showStatus(`❌ Waveform Error: ${err?.message || err}`, "error"); // Show error message (use err.message if available)

              // Clean up the problematic WaveSurfer instance so it doesn't interfere
              if (wavesurfer) {
                  try { wavesurfer.destroy(); } catch(e) { console.warn("Error destroying wavesurfer after error:", e); }
                   wavesurfer = null; // Ensure the global reference is nullified
              }
              // Update the container text to inform the user about the error
              waveformContainer.textContent = `Waveform could not be loaded: ${err?.message || err}`;
               // Reset UI state, preserving audio data if it exists
              resetApp(true); // This will call updateButtonStates("recorded" or "idle") based on audioBlob
          });

          // Event fires when the WaveSurfer instance is destroyed
           wavesurfer.on("destroy", () => {
               console.log("WaveSurfer destroyed.");
               // Clear the content of the waveform container element
               waveformContainer.innerHTML = "";
                // Note: If initializeWaveSurfer is called again, it will recreate the container element
           });

           // --- End WaveSurfer Event Handlers ---

           console.log("WaveSurfer instance created.");

      } catch (e) {
          // Handle synchronous errors that occur during WaveSurfer.create()
          console.error("WaveSurfer initialization failed:", e);
          waveformContainer.textContent = "WaveSurfer could not initialize. Audio playback and waveform visualization disabled.";
          wavesurfer = null; // Ensure wavesurfer variable is null
          playPauseBtn.disabled = true; // Disable playback button
          showStatus("❌ Waveform initialization failed.", "error"); // Show status message
      }
  }

  // --- Initial Setup ---
  initializeWaveSurfer(); // Initialize WaveSurfer when the DOM is ready
  resetApp(false); // Set initial state to idle (clears everything and sets button states)
  // --- End Initial Setup ---

});