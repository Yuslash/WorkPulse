from PyQt5.QtWidgets import QApplication
from windows.login_window import LoginWindow  # Import LoginWindow from your windows folder

if __name__ == '__main__':
    app = QApplication([])

    # Create and show the login window first
    login_window = LoginWindow()
    login_window.show()

    # Run the application
    app.exec_()
