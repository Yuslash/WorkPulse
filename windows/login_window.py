from PyQt5.QtWidgets import QWidget, QLabel, QLineEdit, QPushButton, QVBoxLayout, QSpacerItem, QSizePolicy
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from windows.main_window import MainWindow

class LoginWindow(QWidget):
    def __init__(self):
        super().__init__()

        # Set the window title and size
        self.setWindowTitle("Login")
        self.setFixedSize(337, 604)
        self.setContentsMargins(10, 10, 10, 10)

        # Set font (you can change this globally in the app if needed)
        font = QFont("Jost", 12)
        self.setFont(font)

        # Make the window frameless and transparent
        # self.setAttribute(Qt.WA_TranslucentBackground, True)
        # self.setWindowFlag(Qt.FramelessWindowHint)

        # Main layout for the login page
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(20, 40, 20, 20)
        main_layout.setSpacing(20)

        # Title Label
        title_label = QLabel("Login", self)
        title_label.setStyleSheet("""
            font-size: 24px;
            font-weight: bold;
            color: #C0B6F2;
        """)
        main_layout.addWidget(title_label, alignment=Qt.AlignCenter)

        # Username input field
        self.username_input = QLineEdit(self)
        self.username_input.setPlaceholderText("Username")
        self.username_input.setStyleSheet("""
            padding: 10px;
            font-size: 14px;
            border: 1px solid #8160C7;
            border-radius: 8px;
        """)
        main_layout.addWidget(self.username_input)

        # Password input field
        self.password_input = QLineEdit(self)
        self.password_input.setPlaceholderText("Password")
        self.password_input.setEchoMode(QLineEdit.Password)
        self.password_input.setStyleSheet("""
            padding: 10px;
            font-size: 14px;
            border: 1px solid #8160C7;
            border-radius: 8px;
        """)
        main_layout.addWidget(self.password_input)

        # Login Button
        self.login_button = QPushButton("Login", self)
        self.login_button.setStyleSheet("""
            background-color: #270E53;
            border: 1px solid #8160C7;
            border-radius: 8px;
            color: white;
            font-size: 16px;
            padding: 12px 10px;
        """)
        main_layout.addWidget(self.login_button)

        # Add spacing at the bottom
        main_layout.addItem(QSpacerItem(20, 40, QSizePolicy.Minimum, QSizePolicy.Expanding))

        # Set the main layout for the window
        self.setLayout(main_layout)

        # Connect button to the login action (for now just navigation)
        self.login_button.clicked.connect(self.navigate_to_main_window)

        # For dragging the window (similar to the MainWindow)
        self._mouse_pos = None

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._mouse_pos = event.globalPos() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, event):
        if self._mouse_pos is not None:
            self.move(event.globalPos() - self._mouse_pos)

    def mouseReleaseEvent(self, event):
        self._mouse_pos = None

    def navigate_to_main_window(self):
        # This is where we would navigate to the main window
        print("Navigating to the main window... (not integrated yet)")

        # Create the Main Window and show it
        self.main_window = MainWindow()  # Make sure you've imported MainWindow
        self.main_window.show()

        # Close the current login window
        self.close()
