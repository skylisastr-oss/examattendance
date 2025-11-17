/* ============================================
   CONFIG
============================================ */
const API = "http://localhost:5000/api" || "https://examattendance.onrender.com";

// Test API connection on startup
async function testAPIConnection() {
  try {
    console.log("Testing API connection to:", `${API}/health`);
    const response = await fetch(`${API}/health`);
    const data = await response.json();
    console.log("✅ API Connection successful:", data);
    return true;
  } catch (error) {
    console.error("❌ API Connection failed:", error);
    Swal.fire({
      title: "Server Not Running",
      html: `
        Could not connect to backend server.<br><br>
        <strong>Please ensure:</strong><br>
        1. Node.js server is running (node server.js)<br>
        2. Server is on port 5000<br>
        3. MongoDB is connected
      `,
      icon: "error",
      confirmButtonText: "OK"
    });
    return false;
  }
}

// Test connection on page load
testAPIConnection();

/* ============================================
   DOM ELEMENTS
============================================ */
const pages = document.querySelectorAll('.page');
const navItems = document.querySelectorAll('.nav-item');

const todayDate = document.getElementById('todayDate');
todayDate.textContent = new Date().toLocaleDateString();

/* ============================================
   NAVIGATION
============================================ */
navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');

    const view = item.getAttribute('data-view');
    pages.forEach(page => page.classList.remove('active'));
    document.getElementById(view).classList.add('active');

    // Stop all cameras first
    if (checkInStream) {
      stopCamera(checkInStream, document.getElementById("video"), document.getElementById("stopCamera"));
      if (checkInInterval) clearInterval(checkInInterval);
      checkInStream = null;
    }
    if (registerStream) {
      stopCamera(registerStream, document.getElementById("videoReg"), document.getElementById("stopCameraReg"));
      if (registerInterval) clearInterval(registerInterval);
      registerStream = null;
    }

    // Start appropriate camera after a brief delay
    setTimeout(() => {
      if (view === 'home') {
        initCheckInCamera();
      } else if (view === 'register') {
        initRegisterCamera();
      }
    }, 100);
  });
});

/* ============================================
   FACE API MODEL LOADING
============================================ */
let modelsLoaded = false;

async function loadModels() {
  try {
    document.getElementById("model-status").textContent = "Loading Face Models...";

    // Use local models if available, otherwise use CDN
    const MODEL_PATH = window.location.origin.includes('localhost') 
      ? '/models/' 
      : "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";

    console.log("Loading models from:", MODEL_PATH);

    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_PATH);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_PATH);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_PATH);
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_PATH);

    modelsLoaded = true;
    document.getElementById("model-status").textContent = "Face Models Ready ✅";
    console.log("✅ All face detection models loaded successfully");
    
    // Auto-start check-in camera (home page is active by default)
    setTimeout(() => initCheckInCamera(), 500);
  } catch (error) {
    console.error("Model loading error:", error);
    document.getElementById("model-status").textContent = "Error loading models ❌";
    Swal.fire("Error", "Failed to load face detection models. Check console for details.", "error");
  }
}

loadModels();

/* ============================================
   CAMERA MANAGEMENT
============================================ */
let checkInStream = null;
let registerStream = null;

async function startCamera(video, stopBtn) {
  if (!modelsLoaded) {
    Swal.fire("Please wait", "Models are still loading.", "warning");
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { width: 640, height: 480 } 
    });
    video.srcObject = stream;
    
    // Wait for video to be ready
    await new Promise(resolve => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });
    
    if (stopBtn) stopBtn.classList.remove("hidden");
    return stream;
  } catch (error) {
    console.error("Camera error:", error);
    Swal.fire("Camera Error", "Could not access camera. Please check permissions.", "error");
    return null;
  }
}

function stopCamera(stream, video, stopBtn) {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
  if (stopBtn) stopBtn.classList.add("hidden");
  if (video) video.srcObject = null;
}

/* ============================================
   FACE DETECTION LOOP
============================================ */
function startDetectionLoop(video, canvas, onDetection) {
  const displaySize = { width: video.videoWidth, height: video.videoHeight };
  faceapi.matchDimensions(canvas, displaySize);

  const interval = setInterval(async () => {
    if (!video.srcObject) {
      clearInterval(interval);
      return;
    }

    try {
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptors();

      const resized = faceapi.resizeResults(detections, displaySize);

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      resized.forEach(det => {
        const box = det.detection.box;
        ctx.strokeStyle = "#4f46e5";
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
      });

      if (onDetection) onDetection(resized);
    } catch (error) {
      console.error("Detection error:", error);
    }
  }, 150);

  return interval;
}

/* ============================================
   CHECK-IN CAMERA
============================================ */
let checkInDetections = [];
let checkInInterval = null;

async function initCheckInCamera() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  const stopBtn = document.getElementById("stopCamera");
  const verifyBtn = document.getElementById("startVerify");

  // Stop existing stream
  if (checkInStream) {
    stopCamera(checkInStream, video, stopBtn);
    if (checkInInterval) clearInterval(checkInInterval);
  }

  checkInStream = await startCamera(video, stopBtn);
  
  if (checkInStream) {
    checkInInterval = startDetectionLoop(video, canvas, (detections) => {
      checkInDetections = detections;
      
      // Enable verify button if face detected
      if (detections.length > 0) {
        verifyBtn.classList.remove("disabled");
      } else {
        verifyBtn.classList.add("disabled");
      }
    });
  }

  // Stop camera button
  stopBtn.onclick = () => {
    stopCamera(checkInStream, video, stopBtn);
    if (checkInInterval) clearInterval(checkInInterval);
    checkInStream = null;
    verifyBtn.classList.add("disabled");
  };
}

/* ============================================
   REGISTER CAMERA
============================================ */
let registerDetections = [];
let registerInterval = null;
let capturedSamples = [];

async function initRegisterCamera() {
  const video = document.getElementById("videoReg");
  const canvas = document.getElementById("overlayReg");
  const stopBtn = document.getElementById("stopCameraReg");
  const captureBtn = document.getElementById("captureFace");

  console.log("Initializing register camera...");

  // Stop existing stream
  if (registerStream) {
    stopCamera(registerStream, video, stopBtn);
    if (registerInterval) clearInterval(registerInterval);
  }

  registerStream = await startCamera(video, stopBtn);
  
  if (registerStream) {
    console.log("Register camera started, beginning detection loop...");
    
    registerInterval = startDetectionLoop(video, canvas, (detections) => {
      registerDetections = detections;
      
      // Enable capture button if face detected
      if (detections.length > 0) {
        captureBtn.classList.remove("disabled");
        captureBtn.style.cursor = "pointer";
        captureBtn.style.opacity = "1";
        console.log("Face detected, button enabled");
      } else {
        captureBtn.classList.add("disabled");
        captureBtn.style.cursor = "not-allowed";
        captureBtn.style.opacity = "0.5";
      }
    });
  } else {
    console.error("Failed to start register camera");
  }

  // Stop camera button
  stopBtn.onclick = () => {
    stopCamera(registerStream, video, stopBtn);
    if (registerInterval) clearInterval(registerInterval);
    registerStream = null;
    captureBtn.classList.add("disabled");
  };
}

/* ============================================
   STUDENT REGISTRATION
============================================ */
document.getElementById("captureFace").addEventListener("click", async () => {
  console.log("Capture button clicked!");
  console.log("Detections:", registerDetections);
  console.log("Samples so far:", capturedSamples.length);
  
  if (!registerDetections || registerDetections.length === 0) {
    Swal.fire("No Face Detected", "Position your face clearly in the camera.", "error");
    return;
  }

  const descriptor = Array.from(registerDetections[0].descriptor);
  capturedSamples.push(descriptor);

  Swal.fire({
    title: "Captured!",
    text: `Sample ${capturedSamples.length}/3 captured successfully`,
    icon: "success",
    timer: 1500,
    showConfirmButton: false
  });

  const captureBtn = document.getElementById("captureFace");
  const registerBtn = document.getElementById("registerStudent");

  if (capturedSamples.length >= 3) {
    registerBtn.classList.remove("disabled");
    registerBtn.style.cursor = "pointer";
    registerBtn.style.opacity = "1";
    captureBtn.textContent = `✓ ${capturedSamples.length} Samples Captured`;
    captureBtn.classList.add("disabled");
    console.log("All 3 samples captured, register button enabled");
  } else {
    captureBtn.textContent = `Capture Face (${capturedSamples.length}/3)`;
  }
});

document.getElementById("registerStudent").addEventListener("click", async () => {
  console.log("Register button clicked!");
  
  const id = document.getElementById("reg_id").value.trim().toUpperCase();
  const name = document.getElementById("reg_name").value.trim();
  const course = document.getElementById("reg_course").value.trim();

  console.log("Form values:", { id, name, course, samples: capturedSamples.length });

  if (!id || !name || !course) {
    Swal.fire("Missing Fields", "Please fill in Student ID, Name, and Course.", "error");
    return;
  }

  if (capturedSamples.length < 3) {
    Swal.fire("Missing Face Samples", "Please capture 3 face samples first.", "error");
    return;
  }

  // Average the face descriptors
  const avgDescriptor = capturedSamples[0].map((_, i) => {
    const sum = capturedSamples.reduce((acc, sample) => acc + sample[i], 0);
    return sum / capturedSamples.length;
  });

  console.log("Sending registration request...");

  try {
    const res = await fetch(`${API}/students/register`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        studentId: id,
        name,
        course,
        faceDescriptor: avgDescriptor
      })
    });

    const data = await res.json();
    console.log("Server response:", data);

    if (data.success) {
      Swal.fire("Success", "Student registered successfully!", "success");
      
      // Reset form
      document.getElementById("reg_id").value = "";
      document.getElementById("reg_name").value = "";
      document.getElementById("reg_course").value = "";
      capturedSamples = [];
      document.getElementById("captureFace").textContent = "Capture Face (0/3)";
      document.getElementById("captureFace").classList.remove("disabled");
      document.getElementById("registerStudent").classList.add("disabled");
      document.getElementById("registerStudent").style.opacity = "0.5";
      
      loadStudents();
      loadDescriptors();
    } else {
      Swal.fire("Error", data.message, "error");
    }
  } catch (error) {
    console.error("Registration error:", error);
    Swal.fire("Error", "Could not connect to server. Make sure the backend is running on port 5000.", "error");
  }
});

/* ============================================
   LOAD STUDENTS & ATTENDANCE
============================================ */
async function loadStudents() {
  try {
    console.log("Loading students from:", `${API}/students`);
    const res = await fetch(`${API}/students`);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    
    const json = await res.json();
    console.log("Students loaded:", json);

    const container = document.getElementById("studentsList");
    
    if (!json.data || json.count === 0) {
      container.innerHTML = "<p>No students registered yet.</p>";
      return;
    }

    container.innerHTML = "";
    json.data.forEach(st => {
      container.innerHTML += `
        <div class="student-card">
          <h3>${st.name}</h3>
          <p><b>ID:</b> ${st.studentId}</p>
          <p><b>Course:</b> ${st.course}</p>
        </div>
      `;
    });
  } catch (error) {
    console.error("Load students error:", error);
    document.getElementById("studentsList").innerHTML = 
      `<p style="color: red;">❌ Could not load students: ${error.message}<br>Make sure server is running on port 5000.</p>`;
  }
}

async function loadAttendance() {
  try {
    console.log("Loading attendance from:", `${API}/attendance/today`);
    const res = await fetch(`${API}/attendance/today`);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    
    const json = await res.json();
    console.log("Attendance loaded:", json);

    const container = document.getElementById("attendanceTable");

    if (!json.data || json.count === 0) {
      container.innerHTML = `<p>No attendance yet today.</p>`;
      return;
    }

    let html = `
      <table>
        <tr><th>ID</th><th>Name</th><th>Course</th><th>Time</th><th>Confidence</th></tr>
    `;

    json.data.forEach(a => {
      const t = new Date(a.checkInTime).toLocaleTimeString();
      html += `
        <tr>
          <td>${a.studentId}</td>
          <td>${a.name}</td>
          <td>${a.course}</td>
          <td>${t}</td>
          <td>${a.confidence || "N/A"}%</td>
        </tr>
      `;
    });

    html += "</table>";
    container.innerHTML = html;
  } catch (error) {
    console.error("Load attendance error:", error);
    document.getElementById("attendanceTable").innerHTML = 
      `<p style="color: red;">❌ Could not load attendance: ${error.message}<br>Make sure server is running on port 5000.</p>`;
  }
}

// Load initial data
loadStudents();
loadAttendance();

/* ============================================
   CHECK IN / VERIFY FACE
============================================ */
let studentDescriptors = [];

async function loadDescriptors() {
  try {
    console.log("Loading descriptors from:", `${API}/students/descriptors`);
    const res = await fetch(`${API}/students/descriptors`);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    
    const json = await res.json();
    studentDescriptors = json.data || [];
    console.log(`✅ Loaded ${studentDescriptors.length} student face descriptors`);
  } catch (error) {
    console.error("Load descriptors error:", error);
    console.log("❌ Could not load student descriptors. Face verification will not work.");
  }
}

loadDescriptors();

function euclideanDistance(a, b) {
  return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0));
}

document.getElementById("startVerify").addEventListener("click", async () => {
  if (!checkInDetections || checkInDetections.length === 0) {
    Swal.fire("No Face Detected", "Try again.", "error");
    return;
  }

  if (studentDescriptors.length === 0) {
    Swal.fire("No Students", "No students registered yet.", "warning");
    return;
  }

  const faceDescriptor = Array.from(checkInDetections[0].descriptor);

  let bestMatch = null;
  let bestDistance = 0.6; // Threshold

  studentDescriptors.forEach(student => {
    const distance = euclideanDistance(faceDescriptor, student.faceData);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = student;
    }
  });

  if (!bestMatch) {
    Swal.fire("Not Recognized", "No match found in system", "error");
    return;
  }

  const confidence = ((1 - bestDistance) * 100).toFixed(1);

  try {
    // Mark attendance
    const res = await fetch(`${API}/attendance/checkin`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        studentId: bestMatch.id,
        name: bestMatch.name,
        course: bestMatch.course,
        confidence
      })
    });

    const data = await res.json();

    if (data.success) {
      Swal.fire("Success", `Welcome ${bestMatch.name}!`, "success");
      loadAttendance();
    } else {
      Swal.fire("Info", data.message, "info");
    }
  } catch (error) {
    console.error("Check-in error:", error);
    Swal.fire("Error", "Could not mark attendance. Check server connection.", "error");
  }
});

/* ============================================
   EXPORT CSV
============================================ */
document.getElementById("exportCSV").addEventListener("click", () => {
  window.open(`${API}/attendance/today?format=csv`, '_blank');
});