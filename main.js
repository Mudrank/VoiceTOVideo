document.addEventListener("DOMContentLoaded", function () {
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
    const recordingIndicator = document.getElementById("recording-indicator");
    const audioDurationSpan = document.getElementById("audio-duration");
    const statusDiv = document.getElementById("status");
    const waveformContainer = document.getElementById("waveform"); // Added waveform container
  
    // =====================
    // Global State Variables
    // =====================
    let mediaRecorder;
    let audioChunks = [];
    let recognition;
    let finalTranscript = "";
    let stream; // Microphone stream
    let audioBlob; // Recorded audio blob
    let audioUrl; // Fallback audio URL (if needed, less used now)
    let wavesurfer; // WaveSurfer instance
    let isRecording = false;
    let isProcessingStop = false;
    let supportedAudioType = "";
    let statusTimeoutId = null;
  
    // Added for video generation audio stream management and canvas animation cleanup
    let audioContext = null; // Reference to AudioContext used in video generation
    let bufferSourceNode = null; // Reference to BufferSourceNode used in video generation
    let destinationNode = null; // Reference to MediaStreamDestinationNode used in video generation
    let canvasAnimationId = null; // Store animation frame ID for canvas
  
    // =====================
    // Constants
    // =====================
    const MIN_RECORDING_BLOB_SIZE = 100; // in bytes
    const STATUS_MESSAGE_DURATION = 4000; // in milliseconds
  
    // =====================
    // API Checks
    // =====================
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const hasSpeechRecognition = !!SpeechRecognition;
    const hasMediaDevices = !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia;
    const hasMediaRecorder = !!window.MediaRecorder;
    const hasCanvasCaptureStream = !!HTMLCanvasElement.prototype.captureStream;
    const hasAudioContext = !!(window.AudioContext || window.webkitAudioContext); // Check for Web Audio API
  
    // =====================
    // Utility Functions
    // =====================
    function formatTime(seconds) {
      const minutes = Math.floor(seconds / 60);
      const remaining = Math.floor(seconds % 60);
      return `${minutes}:${remaining.toString().padStart(2, "0")}`;
    }
  
    // downloadBlob: Creates an object URL and triggers a download.
    function downloadBlob(blob, filename) {
      if (!blob) {
        showStatus("Error: No data available for download.", "error");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus("Download started.", "success", 2000);
    }
  
    function showStatus(message, type = "info", duration = STATUS_MESSAGE_DURATION) {
      console.log(`Status (${type}): ${message}`);
      if (statusTimeoutId) {
        clearTimeout(statusTimeoutId);
        statusTimeoutId = null;
      }
      statusDiv.textContent = message;
      statusDiv.className = `status visible ${type}`;
      if (duration > 0) {
        statusTimeoutId = setTimeout(() => {
          statusDiv.className = "status info";
          statusDiv.textContent = "";
        }, duration);
      }
    }
  
    function updateButtonStates(state) {
      const isIdle = state === "idle";
      const isRecordingState = state === "recording";
      const isRecorded = state === "recorded";
      const isProcessing = state === "processing";
  
      startBtn.disabled = !isIdle || !hasMediaDevices || !hasMediaRecorder;
      stopBtn.disabled = !isRecordingState || isProcessingStop;
      resetBtn.disabled = isIdle || isProcessing;
      clearUIBtn.disabled = isIdle || isProcessing;
      recordingIndicator.style.display = isRecordingState ? "block" : "none";
  
      playPauseBtn.disabled = !isRecorded || isProcessing || !wavesurfer || !wavesurfer.isReady;
      downloadBtn.disabled = !isRecorded || isProcessing || !audioBlob;
      exportBtn.disabled = !isRecorded || isProcessing || !subtitle.value.trim();
      // Disable video button if requirements aren't met
      videoBtn.disabled = !isRecorded || isProcessing || !audioBlob || !subtitle.value.trim() || !hasCanvasCaptureStream || !hasAudioContext;
  
      subtitle.readOnly = !isRecorded || isProcessing;
  
      if (isProcessing) {
        showStatus("⏳ Processing... Please wait.", "processing", 0);
      } else if (isRecordingState) {
        showStatus("🔴 Recording...", "info", 0);
      } else if (isIdle) {
          showStatus("Ready. Click 'Start Recording' to begin.", "info");
      } else if (isRecorded) {
           // Status message is updated in wavesurfer.on('ready') or mediaRecorder.onstop fallback
      }
    }
  
    // =====================
    // Reset Functions
    // =====================
    // resetApp(preserveAudio): If preserveAudio === true, clear only the UI (transcription, waveform) but keep the audioBlob.
    // Otherwise, clear all recorded data.
    function resetApp(preserveAudio = false) {
      console.log("Resetting application. Preserve audio:", preserveAudio);
      isRecording = false;
      isProcessingStop = false;
  
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        try {
          mediaRecorder.stop(); // This will trigger onstop if state changes
        } catch (e) {
          console.warn("Error stopping MediaRecorder during reset:", e);
        }
      }
       // Ensure mediaRecorder is set to null immediately so subsequent logic knows it's inactive
      mediaRecorder = null;
  
  
      if (recognition && typeof recognition.abort === "function") {
        try {
          recognition.abort();
        } catch (e) {
          console.warn("Error aborting SpeechRecognition during reset:", e);
        }
      }
      // Ensure recognition is set to null immediately
      recognition = null;
  
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
  
      audioChunks = [];
      finalTranscript = "";
      subtitle.value = "";
      subtitle.placeholder = hasMediaDevices && hasMediaRecorder ? 'Click "Start Recording" to begin.' : "Recording not supported by this browser.";
      audioDurationSpan.textContent = "0:00";
      playPauseBtn.textContent = "Play";
      playPauseBtn.disabled = true; // Disable playback controls initially
  
      if (!preserveAudio) {
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
          audioUrl = null;
        }
        audioBlob = null;
        supportedAudioType = "";
      }
  
      if (wavesurfer) {
          try {
               if (wavesurfer.isPlaying()) {
                   wavesurfer.stop();
               }
              wavesurfer.empty();
              // wavesurfer.seekTo(0); // empty() handles this
              wavesurfer.isReady = false;
              // Re-enable interaction after empty? No, updateButtonStates handles this.
           } catch(e) {
              console.warn("Error resetting WaveSurfer:", e);
           }
      }
  
      // Cleanup Web Audio resources if they exist (primarily for video generation)
      if (bufferSourceNode) {
          try {
              bufferSourceNode.stop(); // Stop playback if active
              bufferSourceNode.disconnect();
          } catch (e) { console.warn("Error stopping/disconnecting bufferSourceNode during reset:", e); }
          bufferSourceNode = null;
      }
      if (destinationNode) {
          try {
              destinationNode.disconnect();
          } catch (e) { console.warn("Error disconnecting destinationNode during reset:", e); }
          destinationNode = null;
      }
      // Close AudioContext if it exists, unless we explicitly wanted it open for other reasons
       if (audioContext) {
            audioContext.close().then(() => {
                 console.log("AudioContext closed during reset.");
                 audioContext = null; // Clear reference
            }).catch(e => console.warn("Error closing AudioContext during reset:", e));
       }
       // Also cancel any lingering canvas animation frame
       if(canvasAnimationId) {
           cancelAnimationFrame(canvasAnimationId);
           canvasAnimationId = null;
       }
  
  
      showStatus("Application reset.", "info", 2000);
      updateButtonStates("idle"); // Ensure buttons reflect the new state
      console.log("Application has been reset.");
    }
  
    // =====================
    // Recording Functions
    // =====================
    async function startRecording() {
      console.log("Starting recording...");
      if (isRecording || isProcessingStop) {
        showStatus("Already recording or stopping!", "warning");
        return;
      }
      // For a new session, perform a full reset.
      resetApp(false); // Always fully reset on start
  
      isRecording = true;
      updateButtonStates("recording");
      subtitle.placeholder = "🔴 Listening... Speak now!";
      subtitle.readOnly = true; // Make readonly during recording
  
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("Microphone access granted.");
      } catch (err) {
        console.error("Microphone error:", err);
        showStatus(`❌ Microphone Error: ${err.message}. Please grant permission and try again.`, "error", 0);
        resetApp(false); // Reset on microphone error
        return;
      }
  
      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/mp4", // AAC
        "audio/mpeg" // MP3 - Less common in MediaRecorder, check support
      ];
      supportedAudioType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
      if (!supportedAudioType) {
        console.error("No supported MIME type for recording.");
        showStatus("❌ Recording Error: No suitable audio format supported by this browser.", "error", 0);
        stream.getTracks().forEach((track) => track.stop());
        resetApp(false);
        return;
      }
      console.log(`Using audio format: ${supportedAudioType}`);
  
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: supportedAudioType });
        console.log("MediaRecorder initialized.");
      } catch (e) {
        console.error("MediaRecorder initialization error:", e);
        showStatus(`❌ Recorder Setup Error: ${e.message}`, "error", 0);
        stream.getTracks().forEach((track) => track.stop());
        resetApp(false);
        return;
      }
  
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
          console.log(`Received data chunk: ${event.data.size} bytes. Total chunks: ${audioChunks.length}`);
        } else {
          console.warn("Received empty data chunk.");
        }
      };
  
      mediaRecorder.onstop = () => {
        console.log("MediaRecorder onstop triggered.");
        isRecording = false; // Update state immediately
        isProcessingStop = false; // Reset processing flag
  
        // Stop the microphone stream after recording stops.
        stream?.getTracks().forEach((track) => track.stop());
        stream = null; // Clear the stream reference
  
        if (audioChunks.length === 0) {
          console.warn("No audio data captured on stop.");
          showStatus("⚠️ Recording failed: No audio data captured.", "warning");
          resetApp(false); // Full reset if no data
          return;
        }
  
        try {
          audioBlob = new Blob(audioChunks, { type: supportedAudioType });
          console.log(`Audio Blob created. Size: ${audioBlob.size} bytes, Type: ${audioBlob.type}`);
          audioChunks = []; // Clear chunks after creating blob
  
          if (audioBlob.size < MIN_RECORDING_BLOB_SIZE) {
            console.warn(`Audio Blob too small (${audioBlob.size} bytes).`);
            showStatus("Recording too short. Record a longer clip.", "warning");
            resetApp(false);
            return;
          }
  
        } catch (e) {
          console.error("Error creating audio Blob:", e);
          showStatus(`❌ Audio Processing Error: ${e.message}`, "error");
          resetApp(false);
          return;
        }
  
        // Load audio into WaveSurfer and update UI state
        if (wavesurfer) {
             updateButtonStates("processing"); // Show processing status while loading waveform
             showStatus("⏳ Processing audio waveform...", "processing", 0);
             try {
               // Use loadBlob if available (more efficient), otherwise load via URL
               if (typeof wavesurfer.loadBlob === "function") {
                 wavesurfer.loadBlob(audioBlob);
               } else {
                  if (audioUrl) URL.revokeObjectURL(audioUrl); // Clean up previous URL
                  audioUrl = URL.createObjectURL(audioBlob);
                  if (!audioUrl || audioUrl.trim() === "") {
                    throw new Error("Empty audio URL generated.");
                  }
                 wavesurfer.load(audioUrl);
               }
               console.log("Attempting to load audio into WaveSurfer.");
             } catch (loadError) {
               console.error("Error loading audio into WaveSurfer:", loadError);
               showStatus(`❌ Waveform Error: ${loadError.message}`, "error");
               resetApp(false);
             }
        } else {
            console.warn("WaveSurfer not initialized. Cannot load waveform.");
             updateButtonStates("recorded"); // Go to recorded state even without waveform
             showStatus("✅ Audio recorded. Waveform display unavailable.", "success");
             // Manually update relevant UI elements if WaveSurfer isn't used
             const tempAudio = document.createElement('audio');
             tempAudio.preload = 'metadata';
             tempAudio.onloadedmetadata = function() {
                 const duration = tempAudio.duration;
                 audioDurationSpan.textContent = isNaN(duration) ? "0:00" : formatTime(duration);
                 URL.revokeObjectURL(tempAudio.src); // Clean up
             };
             tempAudio.onerror = function() {
                 console.error("Error getting duration from recorded audio.");
                 URL.revokeObjectURL(tempAudio.src); // Clean up
             }
             tempAudio.src = URL.createObjectURL(audioBlob);
             subtitle.readOnly = false;
             subtitle.placeholder = "Transcription ready. Edit if needed.";
  
        }
        // Note: updateButtonStates("recorded") happens in wavesurfer.on('ready') or above if wavesurfer is null
      };
  
      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event.error);
        showStatus(`❌ Recording Error: ${event.error.name}`, "error", 0);
        resetApp(false); // Full reset on MediaRecorder error
      };
  
      if (hasSpeechRecognition) {
        if (!recognition) { // Initialize recognition only once per recording session
            recognition = new SpeechRecognition();
            recognition.lang = "en-US"; // Consider making language configurable
            recognition.continuous = true; // Keep listening
            recognition.interimResults = true; // Provide results while speaking
            recognition.maxAlternatives = 1; // Only need the top result
  
            recognition.onresult = (event) => {
                let interim = "";
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        // Append final result to cumulative transcript
                        finalTranscript += transcript.trim() + " ";
                        subtitle.value = finalTranscript; // Update textbox with final results
                        // Note: We don't clear interim here, it's handled by the loop condition
                    } else {
                        interim += transcript; // Append interim result
                    }
                }
                 // Display final transcript + current interim result
                subtitle.value = finalTranscript + interim;
  
                // Auto-scroll textarea
                subtitle.scrollTop = subtitle.scrollHeight;
            };
            recognition.onerror = (event) => {
                console.error("Speech Recognition error:", event.error);
                 // Don't show transient errors like 'no-speech' or 'aborted' as major errors
                 if (["no-speech", "aborted", "audio-capture"].indexOf(event.error) === -1) {
                      showStatus(`⚠️ Speech Recognition Error: ${event.error}. Transcription may be incomplete.`, "warning");
                 }
                 // recognition.stop() might have been called internally, or it might need restarting.
                 // Since continuous is true, it should try to restart unless it's a fatal error like 'audio-capture'.
            };
            recognition.onend = () => {
                console.log("Speech recognition ended.");
                subtitle.value = finalTranscript.trim(); // Final trim after recognition stops
                 // If continuous was true and it stopped unexpectedly (not via recognition.stop()),
                 // you might want to try restarting it here, but be careful of infinite loops.
                 // For this application, stopping MediaRecorder also stops recognition, so this is fine.
            };
             recognition.onstart = () => {
                  console.log("Speech recognition started.");
             };
        }
  
        try {
          recognition.start();
          console.log("Attempting to start speech recognition...");
        } catch (e) {
          console.error("Error starting speech recognition:", e);
           // Handle cases where recognition.start() is called when already active, etc.
          if (e.name !== 'InvalidStateError') {
               showStatus(`❌ Speech Rec Error: ${e.message}`, "error");
               recognition = null; // Consider nulling on severe errors
          } else {
              console.log("Speech recognition already started (InvalidStateError)");
          }
        }
      } else {
        console.warn("Speech recognition not supported.");
        subtitle.placeholder = "Recording audio (speech recognition not supported)...";
        showStatus("Speech recognition not supported by this browser.", "warning", 0);
        recognition = null; // Ensure recognition variable is null if not supported
      }
  
      try {
        mediaRecorder.start();
        console.log("Attempting to start MediaRecorder...");
      } catch (e) {
        console.error("Error starting MediaRecorder:", e);
        showStatus(`❌ Failed to start recording: ${e.message}`, "error");
        resetApp(false); // Full reset on MediaRecorder start error
      }
    }
  
    function stopRecording() {
      if (!isRecording || isProcessingStop) {
        console.warn("Stop recording called in an invalid state.");
        return;
      }
      console.log("Stopping recording process...");
      isProcessingStop = true; // Set flag early
      updateButtonStates("processing"); // Indicate processing state
      showStatus("⏳ Stopping recording...", "processing", 0);
  
  
      if (recognition && typeof recognition.stop === "function") {
        try {
          recognition.stop(); // This should trigger recognition.onend
          console.log("recognition.stop() called.");
        } catch (e) {
          console.warn("Error stopping speech recognition:", e);
        }
      } else if (recognition) {
           console.warn("Speech recognition object exists but stop method is not available.");
      }
  
  
      if (
        mediaRecorder &&
        (mediaRecorder.state === "recording" || mediaRecorder.state === "paused")
      ) {
        try {
          mediaRecorder.stop(); // This will trigger mediaRecorder.onstop
          console.log("mediaRecorder.stop() called.");
        } catch (e) {
          console.error("Error stopping MediaRecorder:", e);
          showStatus(`❌ Error stopping recording: ${e.message}`, "error");
          // Reset here if stopping failed critically? The onstop handler should ideally run,
          // but if it doesn't, we might be stuck. Let's add a delayed state update as a fallback.
           setTimeout(() => {
               if (isProcessingStop) { // Check if the flag is still set
                    console.warn("MediaRecorder onstop did not fire after calling stop. Forcing reset.");
                    resetApp(false);
                    showStatus("⚠️ Recording stop issue detected, please try again.", "warning");
               }
           }, 3000); // Wait 3 seconds for onstop
        }
      } else {
        console.warn("MediaRecorder already inactive or null when stop was called.");
        // If recorder wasn't active, just reset state to be safe.
        resetApp(false);
        return;
      }
      // State updates and further processing happen in mediaRecorder.onstop
    }
  
      // =====================
      // Video Generation Function (Modified for Instagram Reel Size and Web Audio API)
      // =====================
      async function generateVideo() {
          const currentTranscript = subtitle.value.trim();
          if (!audioBlob) {
              showStatus("❌ Cannot generate video: No audio recorded.", "error");
              return;
          }
          if (!currentTranscript) {
              showStatus("❌ Cannot generate video: Transcription is empty.", "error");
              return;
          }
          if (!hasCanvasCaptureStream) {
              showStatus("❌ Cannot generate video: Browser does not support Canvas Capture Stream.", "error", 0);
              return;
          }
          if (!hasAudioContext) {
              showStatus("❌ Cannot generate video: Browser does not support Web Audio API.", "error", 0);
              return;
          }
  
          updateButtonStates("processing");
          console.log("Generating video with transcript for Instagram Reel size.");
          showStatus("⏳ Generating video (Reel size)... This may take a moment.", "processing", 0);
  
          // Create a canvas
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          // ** MODIFIED DIMENSIONS FOR INSTAGRAM REEL (9:16 Aspect Ratio: 720x1280 or 1080x1920) **
          const width = 720;
          const height = 1280;
          canvas.width = width;
          canvas.height = height;
          // Optional: Append canvas to body temporarily for debugging
          // document.body.appendChild(canvas);
          // canvas.style.display = 'block'; // Make visible for debug
  
  
          // Text styling (Adjust font size/line height if needed for vertical format)
          ctx.fillStyle = getComputedStyle(document.documentElement)
              .getPropertyValue("--text-light") // Use text color
              .trim();
          // You might want a slightly smaller font size or line height for vertical video
          const fontSize = 40; // Adjusted font size from 36
          const textLineHeight = 50; // Adjusted line height from 45
          ctx.font = `bold ${fontSize}px 'Archivo', sans-serif`; // Ensure 'Archivo' font is loaded or use a fallback
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const textPadding = width * 0.1; // 10% padding on each side
          const maxWidth = width - 2 * textPadding;
          // Vertical position for the center of the text block
          const centerY = height / 2;
  
  
          // Helper for wrapping and centering text.
          function drawWrappedText(context, text, x, y, maxWidth, lineHeight) {
              const words = text.split(" ");
              let line = "";
              let lines = [];
  
              // Step 1: Break text into lines
              for (let n = 0; n < words.length; n++) {
                  const testLine = line + words[n] + (n < words.length - 1 ? " " : ""); // Add space only if not the last word
                  const metrics = context.measureText(testLine);
                  const testWidth = metrics.width;
  
                  if (testWidth > maxWidth && n > 0) {
                      lines.push(line.trim());
                      line = words[n] + (n < words.length - 1 ? " " : "");
                  } else {
                      line = testLine;
                  }
              }
               if (line.trim() !== "") { // Add the last line if it's not empty
                  lines.push(line.trim());
              }
  
  
              // Step 2: Calculate vertical centering
              const totalTextHeight = lines.length * lineHeight;
              // Start position for the first line, vertically centered
              let currentY = y - totalTextHeight / 2 + lineHeight / 2;
  
  
              // Step 3: Draw each line
              lines.forEach((singleLine) => {
                  context.fillText(singleLine, x, currentY);
                  currentY += lineHeight;
              });
          }
  
  
          // Animation loop for the canvas - it just redraws the static text
          // This is necessary because captureStream needs the canvas to be actively updated
          function animateCanvas() {
              ctx.fillStyle = getComputedStyle(document.documentElement)
                  .getPropertyValue("--bg-dark") // Use background color
                  .trim();
              ctx.fillRect(0, 0, width, height); // Draw background
              ctx.fillStyle = getComputedStyle(document.documentElement)
                  .getPropertyValue("--text-light") // Use text color
                  .trim();
              // Redraw the text centered
              drawWrappedText(ctx, currentTranscript, width / 2, centerY, maxWidth, textLineHeight);
  
              canvasAnimationId = requestAnimationFrame(animateCanvas); // Schedule next frame
          }
  
          // Start the canvas animation
          animateCanvas();
  
          let canvasStream;
          try {
              // Request a video stream from the canvas at 30 frames per second
              canvasStream = canvas.captureStream(30);
              if (!canvasStream || canvasStream.getVideoTracks().length === 0) {
                  throw new Error("Canvas captureStream failed to provide a video track.");
              }
              console.log("Canvas capture stream created.");
          } catch (e) {
              console.error("Error capturing canvas stream:", e);
              showStatus(`❌ Video Error: Canvas capture failed: ${e.message}`, "error", 0);
              if (canvasAnimationId) { // Check if animation was started
                  cancelAnimationFrame(canvasAnimationId); // Stop canvas animation
                  canvasAnimationId = null;
              }
              updateButtonStates("recorded");
              // Optional: remove canvas from body if added for debug
              // canvas.remove();
              return;
          }
  
          // --- Use Web Audio API to get an audio stream from the Blob ---
          // Ensure previous context/nodes are null (handled by resetApp, but defensive check)
          if(audioContext || bufferSourceNode || destinationNode) {
               console.warn("Previous Web Audio resources were not fully cleared before starting video generation.");
               // Attempt cleanup just in case
               try { bufferSourceNode?.stop(); bufferSourceNode?.disconnect(); } catch(e){console.warn("Cleanup bufferSourceNode:",e);}
               try { destinationNode?.disconnect(); } catch(e){console.warn("Cleanup destinationNode:",e);}
               try { audioContext?.close(); } catch(e){console.warn("Cleanup audioContext:",e);}
                bufferSourceNode = null; destinationNode = null; audioContext = null;
          }
  
          try {
              audioContext = new (window.AudioContext || window.webkitAudioContext)();
              console.log("AudioContext created for video generation.");
              destinationNode = audioContext.createMediaStreamDestination(); // Node to get stream from
              audioStream = destinationNode.stream;
  
              if (!audioStream || audioStream.getAudioTracks().length === 0) {
                  throw new Error("Failed to create MediaStreamDestination stream or it has no audio track.");
              }
  
              // Need to fetch the audio blob data as an ArrayBuffer to decode it
              const arrayBuffer = await audioBlob.arrayBuffer();
              const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
              console.log("Audio blob decoded into AudioBuffer.");
  
              bufferSourceNode = audioContext.createBufferSource();
              bufferSourceNode.buffer = audioBuffer; // Set the decoded audio data
              bufferSourceNode.connect(destinationNode); // Connect to the destination node
  
              // The duration comes from the audioBuffer
              const durationSeconds = audioBuffer.duration;
              const durationMillis = Math.ceil(durationSeconds * 1000); // Use ceil to ensure we capture the full duration
  
              // Disconnect the source node when it finishes playing
               // Note: Cleanup (nulling refs, closing context) happens in onstop/onerror
              bufferSourceNode.onended = () => {
                   console.log("Audio source node finished playing.");
                   // The video recorder should stop shortly after this event fires
              };
  
  
              console.log(`Audio duration: ${durationSeconds.toFixed(2)} seconds (${durationMillis} ms).`);
  
          } catch (e) {
              console.error("Error setting up Web Audio API for streaming:", e);
              showStatus(`❌ Video Error: Audio processing failed: ${e.message}`, "error", 0);
               if (canvasAnimationId) { // Check if animation was started
                  cancelAnimationFrame(canvasAnimationId); // Stop canvas animation
                  canvasAnimationId = null;
              }
              canvasStream.getTracks().forEach((track) => track.stop());
              // Optional: remove canvas from body if added for debug
              // canvas.remove();
              // Clean up Web Audio resources
              if (bufferSourceNode) { try { bufferSourceNode.disconnect(); } catch (e) { console.warn("Cleanup bufferSourceNode:", e); } }
              if (destinationNode) { try { destinationNode.disconnect(); } catch (e) { console.warn("Cleanup destinationNode:", e); } }
               if (audioContext) {
                   audioContext.close().catch(e => console.warn("Cleanup audioContext:", e));
              }
              bufferSourceNode = null;
              destinationNode = null;
              audioContext = null;
  
              updateButtonStates("recorded");
              return;
          }
          // --- End Web Audio API setup ---
  
  
          // Combine the canvas stream (video) with the audio stream from Web Audio API.
          const combinedStream = new MediaStream([
              ...canvasStream.getVideoTracks(), // Get video track from canvas
              ...audioStream.getAudioTracks() // Get audio track from Web Audio Destination
          ]);
  
          if (combinedStream.getTracks().length === 0) {
              console.error("Combined stream has no tracks.");
              showStatus("❌ Video Error: Combined stream has no tracks.", "error", 0);
               if (canvasAnimationId) { // Check if animation was started
                  cancelAnimationFrame(canvasAnimationId); // Stop canvas animation
                  canvasAnimationId = null;
              }
              canvasStream.getTracks().forEach((track) => track.stop());
              // Optional: remove canvas from body if added for debug
              // canvas.remove();
              // Clean up Web Audio resources
              if (bufferSourceNode) { try { bufferSourceNode.disconnect(); } catch (e) { console.warn("Cleanup bufferSourceNode:", e); } }
              if (destinationNode) { try { destinationNode.disconnect(); } catch (e) { console.warn("Cleanup destinationNode:", e); } }
               if (audioContext) {
                   audioContext.close().catch(e => console.warn("Cleanup audioContext:", e));
              }
              bufferSourceNode = null;
              destinationNode = null;
              audioContext = null;
  
              updateButtonStates("recorded");
              return;
          }
          console.log(`Combined stream has ${combinedStream.getVideoTracks().length} video track(s) and ${combinedStream.getAudioTracks().length} audio track(s).`);
  
  
          const videoMimeTypes = [
              "video/webm;codecs=vp9,opus", // Prefer VP9 with Opus
              "video/webm;codecs=vp8,opus", // VP8 with Opus
              "video/webm;codecs=vp9", // VP9 (if Opus not supported/needed)
              "video/webm;codecs=vp8", // VP8
              "video/webm", // Generic WebM
              // "video/mp4;codecs=avc1.42E01E,mp4a.40.2" // H.264 with AAC (less likely supported by MediaRecorder for streams)
          ];
          const supportedVideoType = videoMimeTypes.find((type) =>
              MediaRecorder.isTypeSupported(type)
          );
          if (!supportedVideoType) {
              showStatus("❌ Video Error: No suitable video format supported by this browser.", "error", 0);
               if (canvasAnimationId) { // Check if animation was started
                  cancelAnimationFrame(canvasAnimationId); // Stop canvas animation
                  canvasAnimationId = null;
              }
              combinedStream.getTracks().forEach((track) => track.stop()); // Stop all tracks
              // Optional: remove canvas from body if added for debug
              // canvas.remove();
              // Clean up Web Audio resources
              if (bufferSourceNode) { try { bufferSourceNode.disconnect(); } catch (e) { console.warn("Cleanup bufferSourceNode:", e); } }
              if (destinationNode) { try { destinationNode.disconnect(); } catch (e) { console.warn("Cleanup destinationNode:", e); } }
               if (audioContext) {
                   audioContext.close().catch(e => console.warn("Cleanup audioContext:", e));
              }
              bufferSourceNode = null;
              destinationNode = null;
              audioContext = null;
  
  
              updateButtonStates("recorded");
              return;
          }
          console.log(`Using video format: ${supportedVideoType}`);
  
          let videoChunks = [];
          let videoRecorder;
          try {
              videoRecorder = new MediaRecorder(combinedStream, {
                  mimeType: supportedVideoType,
                  // bitsPerSecond: 5000000 // Optional: control video quality (adjust as needed)
              });
              console.log("Video MediaRecorder initialized.");
          } catch (e) {
              console.error("Error creating video MediaRecorder:", e);
              showStatus(`❌ Video Recorder Error: ${e.message}`, "error", 0);
               if (canvasAnimationId) { // Check if animation was started
                  cancelAnimationFrame(canvasAnimationId); // Stop canvas animation
                  canvasAnimationId = null;
              }
              combinedStream.getTracks().forEach((track) => track.stop());
              // Optional: remove canvas from body if added for debug
              // canvas.remove();
              // Clean up Web Audio resources
              if (bufferSourceNode) { try { bufferSourceNode.disconnect(); } catch (e) { console.warn("Cleanup bufferSourceNode:", e); } }
              if (destinationNode) { try { destinationNode.disconnect(); } catch (e) { console.warn("Cleanup destinationNode:", e); } }
               if (audioContext) {
                   audioContext.close().catch(e => console.warn("Cleanup audioContext:", e));
              }
              bufferSourceNode = null;
              destinationNode = null;
              audioContext = null;
  
  
              updateButtonStates("recorded");
              return;
          }
  
          videoRecorder.ondataavailable = (e) => {
              if (e.data.size > 0) {
                  videoChunks.push(e.data);
                  console.log(`Received video data chunk: ${e.data.size} bytes.`);
              } else {
                  console.warn("Received empty video data chunk.");
              }
          };
  
          videoRecorder.onstop = () => {
              console.log("Video recording stopped, processing video blob.");
              // Cleanup resources
              if (canvasAnimationId) { // Check if animation was started
                  cancelAnimationFrame(canvasAnimationId); // Stop canvas animation
                  canvasAnimationId = null;
              }
              // Stop tracks from the combined stream. Note: The tracks might already be stopped
              // if their source nodes (canvasStream, bufferSourceNode) were stopped first.
              combinedStream.getTracks().forEach((track) => track.stop());
              // Optional: remove canvas from body if added for debug
              // canvas.remove();
  
              // Clean up Web Audio resources (disconnect nodes and close context)
              if (bufferSourceNode) {
                  try {
                      bufferSourceNode.disconnect();
                  } catch (e) {
                      console.warn("Error disconnecting bufferSourceNode on video stop:", e);
                  }
                   // bufferSourceNode = null; // Clear reference
              }
              if (destinationNode) {
                  try {
                      destinationNode.disconnect();
                  } catch (e) {
                      console.warn("Error disconnecting destinationNode on video stop:", e);
                  }
                   // destinationNode = null; // Clear reference
              }
               // Close AudioContext after video generation is finalized
               if (audioContext) {
                    audioContext.close().then(() => {
                         console.log("AudioContext closed after video generation.");
                         // audioContext = null; // Clear reference
                    }).catch(e => console.warn("Error closing AudioContext:", e));
               }
              // Clear references after successful cleanup attempt
               bufferSourceNode = null;
               destinationNode = null;
               audioContext = null;
  
  
              if (videoChunks.length === 0 || videoChunks.every(chunk => chunk.size === 0)) {
                  showStatus("❌ Video Generation Failed: No video data produced.", "error");
                  updateButtonStates("recorded");
                  return;
              }
              try {
                  const videoBlob = new Blob(videoChunks, {
                      type: supportedVideoType
                  });
                  console.log(`Video Blob created. Size: ${videoBlob.size} bytes, Type: ${videoBlob.type}`);
                  videoChunks = []; // Clear chunks
  
                  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                  const fileExtension = supportedVideoType.split('/')[1].split(';')[0]; // e.g., 'webm'
                  downloadBlob(videoBlob, `transcription_video_${timestamp}.${fileExtension}`);
  
              } catch (e) {
                  console.error("Error creating video Blob:", e);
                  showStatus(`❌ Error saving video: ${e.message}`, "error");
              } finally {
                  // Make sure button states are updated even on error during blob creation/download
                  updateButtonStates("recorded");
              }
          };
  
          videoRecorder.onerror = (event) => {
              console.error("VideoRecorder error:", event.error);
              showStatus(`❌ Video Generation Error: ${event.error.name}`, "error", 0);
              // Cleanup resources on error
               if (canvasAnimationId) { // Check if animation was started
                  cancelAnimationFrame(canvasAnimationId); // Stop canvas animation
                  canvasAnimationId = null;
              }
              // Stop tracks from the combined stream
              combinedStream.getTracks().forEach((track) => track.stop());
              // Optional: remove canvas from body if added for debug
              // canvas.remove();
              // Clean up Web Audio resources
               if (bufferSourceNode) { try { bufferSourceNode.disconnect(); } catch (e) { console.warn("Cleanup bufferSourceNode:", e); } }
               if (destinationNode) { try { destinationNode.disconnect(); } catch (e) { console.warn("Cleanup destinationNode:", e); } }
              // Close AudioContext on fatal error
              if (audioContext) {
                    audioContext.close().catch(e => console.warn("Cleanup audioContext:", e));
               }
              bufferSourceNode = null;
              destinationNode = null;
              audioContext = null;
  
  
              updateButtonStates("recorded");
          };
  
          // Start video recording and audio playback simultaneously
          try {
              videoRecorder.start();
              console.log("Video recorder started.");
  
              // Start the Web Audio source node to play the audio into the stream
              // The audio will start flowing into the combinedStream being recorded
              if (audioContext && audioContext.state === 'suspended') {
                  // Resume context if it was suspended (e.g., due to browser policy requiring user interaction)
                  audioContext.resume().then(() => {
                      console.log("AudioContext resumed.");
                       if (bufferSourceNode) {
                          bufferSourceNode.start(0); // Start playback from the beginning
                          console.log("Audio source node started.");
                       } else {
                            throw new Error("bufferSourceNode was null after context resume.");
                       }
                  }).catch(e => {
                      console.error("Error resuming AudioContext:", e);
                      showStatus(`❌ Audio Playback Error: ${e.message}`, "error", 0);
                      // Attempt to stop video recorder if audio fails to start
                      if (videoRecorder && videoRecorder.state === 'recording') {
                          try {
                              videoRecorder.stop();
                          } catch (stopErr) {
                              console.error("Error stopping video recorder after audio start failure:", stopErr);
                          }
                      }
                  });
              } else if (bufferSourceNode) {
                  bufferSourceNode.start(0); // Start playback from the beginning
                  console.log("Audio source node started.");
              } else {
                   throw new Error("Audio source node was not properly initialized before start.");
              }
  
  
              // Automatically stop recording after audio duration + a small buffer
              // Ensure durationSeconds was obtained from the AudioBuffer
              const audioDurationMillis = (bufferSourceNode && bufferSourceNode.buffer) ? bufferSourceNode.buffer.duration * 1000 : 3000; // Fallback to 3s if duration unknown
              console.log(`Setting timeout to stop video recorder in ${audioDurationMillis + 500}ms.`);
  
              setTimeout(() => {
                  if (videoRecorder && videoRecorder.state === "recording") {
                      console.log("Timeout reached, stopping video recorder.");
                      try {
                          videoRecorder.stop();
                      } catch (e) {
                          console.error("Error stopping video recorder by timeout:", e);
                          showStatus("⚠️ Error finalizing video by timeout.", "warning");
                          // Cleanup resources manually if onstop doesn't fire (shouldn't happen usually)
                          if (canvasAnimationId) {
                               cancelAnimationFrame(canvasAnimationId);
                               canvasAnimationId = null;
                          }
                           // Stop tracks from the combined stream
                          combinedStream.getTracks().forEach((track) => track.stop());
                           if (bufferSourceNode) { try { bufferSourceNode.disconnect(); } catch (e) { console.warn("Cleanup bufferSourceNode:", e); } bufferSourceNode = null; }
                           if (destinationNode) { try { destinationNode.disconnect(); } catch (e) { console.warn("Cleanup destinationNode:", e); } destinationNode = null; }
                            if (audioContext) {
                                audioContext.close().catch(e => console.warn("Cleanup audioContext:", e));
                                audioContext = null;
                           }
                           updateButtonStates("recorded");
                      }
                  } else {
                       console.log("Video recorder not in 'recording' state when timeout fired.");
                       // Still attempt cleanup if timeout fires and state isn't recording
                        if (canvasAnimationId) {
                           cancelAnimationFrame(canvasAnimationId);
                           canvasAnimationId = null;
                      }
                       combinedStream.getTracks().forEach((track) => track.stop());
                       if (bufferSourceNode) { try { bufferSourceNode.disconnect(); } catch (e) { console.warn("Cleanup bufferSourceNode:", e); } bufferSourceNode = null; }
                       if (destinationNode) { try { destinationNode.disconnect(); } catch (e) { console.warn("Cleanup destinationNode:", e); } destinationNode = null; }
                        if (audioContext) {
                            audioContext.close().catch(e => console.warn("Cleanup audioContext:", e));
                            audioContext = null;
                       }
                  }
              }, audioDurationMillis + 500); // Add a small buffer
  
          } catch (e) {
              console.error("Error starting video recording or audio playback:", e);
              showStatus(`❌ Failed to start video generation: ${e.message}`, "error");
              // Cleanup resources on start error
              if (canvasAnimationId) {
                   cancelAnimationFrame(canvasAnimationId);
                   canvasAnimationId = null;
              }
              combinedStream.getTracks().forEach((track) => track.stop());
              // Optional: remove canvas from body if added for debug
              // canvas.remove();
              // Clean up Web Audio resources
               if (bufferSourceNode) { try { bufferSourceNode.disconnect(); } catch (e) { console.warn("Cleanup bufferSourceNode:", e); } }
               if (destinationNode) { try { destinationNode.disconnect(); } catch (e) { console.warn("Cleanup destinationNode:", e); } }
               if (audioContext) {
                   audioContext.close().catch(e => console.warn("Cleanup audioContext:", e));
              }
              bufferSourceNode = null;
              destinationNode = null;
              audioContext = null;
  
  
              updateButtonStates("recorded");
              return;
          }
      }
  
  
    // =====================
    // Event Listeners & Initialization
    // =====================
    function setupEventListeners() {
      startBtn.addEventListener("click", startRecording);
      stopBtn.addEventListener("click", stopRecording);
      resetBtn.addEventListener("click", () => {
           if (confirm("Are you sure you want to reset? This will discard the current recording and transcription.")) {
               resetApp(false);
           }
      });
      clearUIBtn.addEventListener("click", () => {
          if (audioBlob) { // Only ask if there's audio to preserve
               if (confirm("Clear transcription and waveform but keep recorded audio?")) {
                   resetApp(true);
                   // Manually update state as resetApp(true) doesn't go to 'recorded' state
                   // unless the audioBlob is preserved.
                   if (audioBlob) updateButtonStates("recorded");
               }
          } else {
               // If no audio, clearUI is same as full reset but maybe less alarming confirmation
               if (confirm("Clear the current transcription?")) {
                    resetApp(true);
               }
          }
      });
  
  
      playPauseBtn.addEventListener("click", () => {
        if (wavesurfer && wavesurfer.isReady) {
             // Handle audio context resume for playback if needed (browser policy)
             // Note: This WaveSurfer context is separate from the video generation context
             if (wavesurfer.getBackend() && wavesurfer.getBackend().getAudioContext().state === 'suspended') {
                wavesurfer.getBackend().getAudioContext().resume().then(() => {
                     wavesurfer.playPause();
                     playPauseBtn.textContent = wavesurfer.isPlaying() ? "Pause" : "Play";
                }).catch(e => console.error("Error resuming WaveSurfer AudioContext for playback:", e));
             } else {
                 wavesurfer.playPause();
                 playPauseBtn.textContent = wavesurfer.isPlaying() ? "Pause" : "Play";
             }
        }
      });
  
      downloadBtn.addEventListener("click", () => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const extension = supportedAudioType
          ? supportedAudioType.split("/")[1].split(";")[0]
          : "webm"; // Fallback extension
          const filename = `voice_recording_${timestamp}.${extension}`;
          console.log(`Attempting to download audio as ${filename}`);
        downloadBlob(audioBlob, filename);
      });
  
      exportBtn.addEventListener("click", () => {
        const currentTranscript = subtitle.value.trim();
        if (currentTranscript) {
          const blob = new Blob([currentTranscript], { type: "text/plain;charset=utf-8" });
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
           const filename = `transcription_${timestamp}.txt`;
          console.log(`Attempting to export transcription as ${filename}`);
          downloadBlob(blob, filename);
        } else {
          showStatus("❌ Transcription is empty, cannot export.", "warning");
        }
      });
  
      videoBtn.addEventListener("click", generateVideo);
  
      // Wavesurfer Event Handlers
      if (wavesurfer) {
        wavesurfer.on("ready", () => {
          console.log("WaveSurfer is ready.");
          wavesurfer.isReady = true; // Custom property to indicate readiness
          const duration = wavesurfer.getDuration();
          if (duration > 0) {
            audioDurationSpan.textContent = formatTime(duration);
            // subtitle.readOnly = false; // Handled by updateButtonStates
            updateButtonStates("recorded"); // Transition to recorded state
            showStatus("✅ Audio ready! Transcription is editable.", "success"); // Explicitly show success
          } else {
            console.warn("WaveSurfer loaded but audio duration is 0.");
            showStatus("⚠️ Audio loaded but seems empty. Please record again.", "warning", 0);
            resetApp(false); // Full reset if audio seems invalid
          }
        });
        wavesurfer.on("play", () => {
          playPauseBtn.textContent = "Pause";
        });
        wavesurfer.on("pause", () => {
          playPauseBtn.textContent = "Play";
        });
        wavesurfer.on("finish", () => {
          console.log("WaveSurfer playback finished.");
          playPauseBtn.textContent = "Play";
          wavesurfer.seekTo(0); // Reset playback position to the beginning
        });
        wavesurfer.on("error", (err) => {
          console.error("WaveSurfer error:", err);
          let userMessage = "❌ Error processing audio waveform.";
          // Attempt to provide more specific error messages
          if (typeof err === "string") {
               userMessage = `❌ Waveform Error: ${err}`;
          } else if (err instanceof Error) {
              userMessage = `❌ Waveform Error: ${err.message}`;
          } else if (err && err.message && (err.message.includes("MEDIA_ELEMENT_ERROR") || err.message.includes("decodeAudioData"))) {
               userMessage = "❌ Error decoding audio. Recording might be corrupt or in an unsupported format.";
          } else if (err && err.message && err.message.includes("Empty src")) {
               userMessage = "❌ Waveform Error: Audio source is empty. Please record again.";
          }
  
          showStatus(userMessage, "error", 0);
          // Clean up audio URL if it was used for loading
          if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            audioUrl = null;
          }
          audioBlob = null; // Invalidate audio blob as it caused a loading error
  
          // Reset UI to initial state as the audio is unusable
          // Don't use full resetApp here, just update states and clear relevant UI
          audioDurationSpan.textContent = "0:00";
          playPauseBtn.textContent = "Play";
          playPauseBtn.disabled = true;
          subtitle.value = "";
          subtitle.placeholder = 'Failed to load audio. Click "Start Recording" to try again.';
          subtitle.readOnly = true;
          wavesurfer.empty(); // Ensure waveform is cleared
          wavesurfer.isReady = false;
          updateButtonStates("idle"); // Go back to idle state
        });
        wavesurfer.on("loading", (percent) => {
           // console.log(`WaveSurfer loading: ${percent}%`); // Optional: Log loading progress
           // showStatus(`⏳ Loading waveform: ${percent}%`, "processing", 0); // Optional: Show loading progress in UI
        });
        wavesurfer.on("seek", (progress) => {
             // console.log(`WaveSurfer seeked to: ${progress}`); // Optional: Log seek events
        });
      } else {
        showStatus("❌ WaveSurfer library failed to initialize.", "error", 0);
         // Disable all buttons that depend on WaveSurfer or recorded audio
        document.querySelectorAll(".button-group button, #audio-controls button").forEach(btn => {
            if (btn.id !== 'startBtn' && btn.id !== 'resetBtn') { // Keep start and reset enabled
                btn.disabled = true;
            }
        });
        playPauseBtn.disabled = true;
        videoBtn.disabled = true;
        downloadBtn.disabled = true;
        exportBtn.disabled = true;
        clearUIBtn.disabled = true;
        subtitle.readOnly = true;
        subtitle.placeholder = "Waveform display unavailable.";
      }
    }
  
    function initializeApp() {
      console.log("Initializing application...");
  
       // Initial API checks
      if (!hasMediaDevices || !hasMediaRecorder) {
          showStatus("❌ Recording not supported by this browser (getUserMedia or MediaRecorder missing).", "error", 0);
          startBtn.disabled = true;
      }
       if (!hasCanvasCaptureStream) {
          showStatus("❌ Video generation (visuals) not supported by this browser (Canvas Capture Stream missing).", "warning", 0);
          videoBtn.disabled = true;
       }
       if (!hasAudioContext) {
          showStatus("❌ Advanced audio features (like video generation audio stream) not supported by this browser (Web Audio API missing).", "warning", 0);
          videoBtn.disabled = true; // Video generation depends on Web Audio API stream
       }
      if (!hasSpeechRecognition) {
        showStatus("Speech recognition not supported by this browser.", "warning");
      }
  
      // Initialize WaveSurfer
      try {
        wavesurfer = WaveSurfer.create({
          container: waveformContainer, // Use the correct container element
          waveColor: getComputedStyle(document.documentElement).getPropertyValue("--wave-color").trim(),
          progressColor: getComputedStyle(document.documentElement).getPropertyValue("--wave-progress").trim(),
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--wave-bg").trim(),
          height: 80,
          responsive: true,
          cursorWidth: 1,
          cursorColor: "white",
          barWidth: 2,
          barRadius: 3,
          backend: "WebAudio", // Explicitly use WebAudio backend
          // renderer: 'Canvas', // Default, can be explicit
        });
        console.log("WaveSurfer initialized.");
         // Add a flag to wavesurfer object itself
        wavesurfer.isReady = false;
  
      } catch (e) {
        console.error("Error initializing WaveSurfer:", e);
        wavesurfer = null; // Set to null if initialization fails
        // The check in setupEventListeners will handle disabling buttons and showing status
      }
  
  
      setupEventListeners(); // Set up button listeners etc.
      resetApp(false); // Start in a clean, idle state
  
      console.log("Application initialized.");
    }
  
    // =====================
    // Initialization Call
    // =====================
    initializeApp();
  });