const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files (including models folder)
app.use(express.static(path.join(__dirname)));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/biometricAttendance';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
})
.then(() => console.log('✅ MongoDB Connected Successfully'))
.catch(err => {
  console.error('❌ MongoDB Connection Error:', err.message);
  console.log('\n💡 Quick Fix:');
  console.log('1. Go to https://cloud.mongodb.com/');
  console.log('2. Click "Network Access" → "Add IP Address"');
  console.log('3. Click "Add Current IP Address" or use 0.0.0.0/0 for dev');
  console.log('4. Wait 1-2 minutes and restart this server\n');
});

// Student Schema
const studentSchema = new mongoose.Schema({
  studentId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  course: {
    type: String,
    required: true,
    trim: true
  },
  faceDescriptor: {
    type: [Number],
    required: true
  },
  registeredAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Attendance Schema
const attendanceSchema = new mongoose.Schema({
  studentId: {
    type: String,
    required: true,
    ref: 'Student'
  },
  name: {
    type: String,
    required: true
  },
  course: {
    type: String,
    required: true
  },
  checkInTime: {
    type: Date,
    default: Date.now
  },
  date: {
    type: String,
    required: true
  },
  confidence: {
    type: Number,
    min: 0,
    max: 100
  }
}, {
  timestamps: true
});

// Create indexes for better query performance
attendanceSchema.index({ studentId: 1, date: 1 });

const Student = mongoose.model('Student', studentSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

// ==================== API ROUTES ====================

// API root endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Biometric Attendance System API',
    version: '1.0.0',
    status: 'running',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    endpoints: {
      health: 'GET /api/health',
      students: {
        list: 'GET /api/students',
        register: 'POST /api/students/register',
        descriptors: 'GET /api/students/descriptors',
        getOne: 'GET /api/students/:studentId',
        update: 'PUT /api/students/:studentId',
        delete: 'DELETE /api/students/:studentId'
      },
      attendance: {
        today: 'GET /api/attendance/today',
        checkin: 'POST /api/attendance/checkin',
        byDate: 'GET /api/attendance/date/:date',
        byStudent: 'GET /api/attendance/student/:studentId',
        stats: 'GET /api/attendance/stats'
      }
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Biometric Attendance API is running',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Biometric Attendance System API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      students: '/api/students',
      register: '/api/students/register',
      attendance: '/api/attendance/today'
    }
  });
});

// ========== STUDENT ROUTES ==========

// Register a new student
app.post('/api/students/register', async (req, res) => {
  try {
    console.log('📝 Registration request received');
    const { studentId, name, course, faceDescriptor } = req.body;

    // Validation
    if (!studentId || !name || !course || !faceDescriptor) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required (studentId, name, course, faceDescriptor)' 
      });
    }

    if (!Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
      console.log('❌ Invalid face descriptor length:', faceDescriptor.length);
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid face descriptor. Must be an array of 128 numbers' 
      });
    }

    // Check if student already exists
    const existingStudent = await Student.findOne({ studentId: studentId.toUpperCase() });
    if (existingStudent) {
      console.log('❌ Student ID already exists:', studentId);
      return res.status(409).json({ 
        success: false, 
        message: 'Student ID already registered' 
      });
    }

    // Create new student
    const student = new Student({
      studentId: studentId.toUpperCase(),
      name: name.trim(),
      course: course.trim(),
      faceDescriptor
    });

    await student.save();
    console.log('✅ Student registered:', studentId);

    res.status(201).json({ 
      success: true, 
      message: 'Student registered successfully',
      data: {
        studentId: student.studentId,
        name: student.name,
        course: student.course,
        registeredAt: student.registeredAt
      }
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error registering student',
      error: error.message 
    });
  }
});

// Get all students
app.get('/api/students', async (req, res) => {
  try {
    const students = await Student.find({ isActive: true })
      .select('-faceDescriptor -__v')
      .sort({ name: 1 });

    console.log(`✅ Retrieved ${students.length} students`);

    res.json({ 
      success: true, 
      count: students.length,
      data: students 
    });

  } catch (error) {
    console.error('❌ Fetch students error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching students',
      error: error.message 
    });
  }
});

// Get students with face descriptors (for face recognition)
app.get('/api/students/descriptors', async (req, res) => {
  try {
    const students = await Student.find({ isActive: true })
      .select('studentId name course faceDescriptor')
      .sort({ name: 1 });

    console.log(`✅ Retrieved ${students.length} student descriptors`);

    res.json({ 
      success: true, 
      count: students.length,
      data: students.map(s => ({
        id: s.studentId,
        name: s.name,
        course: s.course,
        faceData: s.faceDescriptor
      }))
    });

  } catch (error) {
    console.error('❌ Fetch descriptors error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching student descriptors',
      error: error.message 
    });
  }
});

// Get single student by ID
app.get('/api/students/:studentId', async (req, res) => {
  try {
    const student = await Student.findOne({ 
      studentId: req.params.studentId.toUpperCase() 
    }).select('-faceDescriptor -__v');

    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    res.json({ 
      success: true, 
      data: student 
    });

  } catch (error) {
    console.error('❌ Fetch student error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching student',
      error: error.message 
    });
  }
});

// Update student
app.put('/api/students/:studentId', async (req, res) => {
  try {
    const { name, course, faceDescriptor } = req.body;
    const updateData = {};

    if (name) updateData.name = name.trim();
    if (course) updateData.course = course.trim();
    if (faceDescriptor) {
      if (!Array.isArray(faceDescriptor) || faceDescriptor.length !== 128) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid face descriptor' 
        });
      }
      updateData.faceDescriptor = faceDescriptor;
    }

    const student = await Student.findOneAndUpdate(
      { studentId: req.params.studentId.toUpperCase() },
      updateData,
      { new: true }
    ).select('-faceDescriptor -__v');

    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    console.log('✅ Student updated:', req.params.studentId);

    res.json({ 
      success: true, 
      message: 'Student updated successfully',
      data: student 
    });

  } catch (error) {
    console.error('❌ Update student error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating student',
      error: error.message 
    });
  }
});

// Delete student (soft delete)
app.delete('/api/students/:studentId', async (req, res) => {
  try {
    const student = await Student.findOneAndUpdate(
      { studentId: req.params.studentId.toUpperCase() },
      { isActive: false },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    console.log('✅ Student deleted:', req.params.studentId);

    res.json({ 
      success: true, 
      message: 'Student deleted successfully' 
    });

  } catch (error) {
    console.error('❌ Delete student error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting student',
      error: error.message 
    });
  }
});

// ========== ATTENDANCE ROUTES ==========

// Mark attendance
app.post('/api/attendance/checkin', async (req, res) => {
  try {
    console.log('✅ Check-in request received');
    const { studentId, name, course, confidence } = req.body;
    const today = new Date().toLocaleDateString();

    // Validation
    if (!studentId || !name || !course) {
      console.log('❌ Missing student information');
      return res.status(400).json({ 
        success: false, 
        message: 'Student information is required' 
      });
    }

    // Check if already checked in today
    const existingAttendance = await Attendance.findOne({ 
      studentId: studentId.toUpperCase(), 
      date: today 
    });

    if (existingAttendance) {
      console.log('⚠️  Student already checked in:', studentId);
      return res.status(409).json({ 
        success: false, 
        message: 'Student already checked in today',
        data: existingAttendance
      });
    }

    // Create attendance record
    const attendance = new Attendance({
      studentId: studentId.toUpperCase(),
      name: name.trim(),
      course: course.trim(),
      date: today,
      confidence: confidence || null
    });

    await attendance.save();
    console.log('✅ Attendance marked:', studentId);

    res.status(201).json({ 
      success: true, 
      message: 'Attendance marked successfully',
      data: attendance
    });

  } catch (error) {
    console.error('❌ Check-in error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error marking attendance',
      error: error.message 
    });
  }
});

// Get today's attendance
app.get('/api/attendance/today', async (req, res) => {
  try {
    const today = new Date().toLocaleDateString();
    
    const attendanceRecords = await Attendance.find({ date: today })
      .sort({ checkInTime: -1 });

    console.log(`✅ Retrieved ${attendanceRecords.length} attendance records for today`);

    res.json({ 
      success: true, 
      date: today,
      count: attendanceRecords.length,
      data: attendanceRecords 
    });

  } catch (error) {
    console.error('❌ Fetch attendance error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching attendance',
      error: error.message 
    });
  }
});

// Get attendance by date
app.get('/api/attendance/date/:date', async (req, res) => {
  try {
    const attendanceRecords = await Attendance.find({ date: req.params.date })
      .sort({ checkInTime: -1 });

    res.json({ 
      success: true, 
      date: req.params.date,
      count: attendanceRecords.length,
      data: attendanceRecords 
    });

  } catch (error) {
    console.error('❌ Fetch attendance error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching attendance',
      error: error.message 
    });
  }
});

// Get attendance by student
app.get('/api/attendance/student/:studentId', async (req, res) => {
  try {
    const attendanceRecords = await Attendance.find({ 
      studentId: req.params.studentId.toUpperCase() 
    }).sort({ checkInTime: -1 });

    res.json({ 
      success: true, 
      studentId: req.params.studentId.toUpperCase(),
      count: attendanceRecords.length,
      data: attendanceRecords 
    });

  } catch (error) {
    console.error('❌ Fetch student attendance error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching student attendance',
      error: error.message 
    });
  }
});

// Get attendance statistics
app.get('/api/attendance/stats', async (req, res) => {
  try {
    const today = new Date().toLocaleDateString();
    const totalStudents = await Student.countDocuments({ isActive: true });
    const presentToday = await Attendance.countDocuments({ date: today });
    const totalAttendanceRecords = await Attendance.countDocuments();

    res.json({ 
      success: true, 
      data: {
        totalStudents,
        presentToday,
        absentToday: totalStudents - presentToday,
        attendanceRate: totalStudents > 0 ? ((presentToday / totalStudents) * 100).toFixed(2) : 0,
        totalAttendanceRecords,
        date: today
      }
    });

  } catch (error) {
    console.error('❌ Fetch stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching statistics',
      error: error.message 
    });
  }
});

// ========== UTILITY ROUTES ==========

// Clear all data (use with caution - for testing only)
app.delete('/api/admin/clear-all', async (req, res) => {
  try {
    await Student.deleteMany({});
    await Attendance.deleteMany({});

    console.log('⚠️  All data cleared');

    res.json({ 
      success: true, 
      message: 'All data cleared successfully' 
    });

  } catch (error) {
    console.error('❌ Clear data error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error clearing data',
      error: error.message 
    });
  }
});

// 404 handler - MUST be after all routes
app.use((req, res) => {
  console.log('❌ 404 - Endpoint not found:', req.method, req.url);
  res.status(404).json({ 
    success: false, 
    message: 'API endpoint not found',
    requested: req.url,
    availableEndpoints: [
      'GET /api/health',
      'GET /api/students',
      'POST /api/students/register',
      'GET /api/students/descriptors',
      'POST /api/attendance/checkin',
      'GET /api/attendance/today'
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n🚀 ========================================');
  console.log(`   Biometric Attendance System API`);
  console.log('   ========================================');
  console.log(`   📡 Server: http://localhost:${PORT}`);
  console.log(`   🔗 API: http://localhost:${PORT}/api`);
  console.log(`   💾 Database: ${MONGODB_URI.includes('localhost') ? 'Local MongoDB' : 'MongoDB Atlas'}`);
  console.log('   ========================================\n');

});
