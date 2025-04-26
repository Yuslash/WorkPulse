from PyQt5.QtWidgets import QPushButton

class CustomButton(QPushButton):
    def __init__(self, text, parent=None):
        super().__init__(text, parent)

        self.setStyleSheet("""
            QPushButton {
                border-radius: 8px;
                border: 1px solid #8160C7;
                background: #270E53;
                color: white;
                font-size: 14px;
                font-weight: 500;
                padding: 12px 10px;
                margin-top: 10px;
            }
            QPushButton:hover {
                background-color: #3A1783;
            }
            QPushButton:pressed {
                background-color: #5B2EB2;
            }
        """)
