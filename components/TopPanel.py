# TopPanel.py
from PyQt5.QtWidgets import QWidget, QLabel, QPushButton, QVBoxLayout
from PyQt5.QtCore import Qt

class TopPanel(QWidget):
    def __init__(self):
        super().__init__()

        self.setContentsMargins(10, 30, 10, 0)  # Margins around the panel

        top_panel_layout = QVBoxLayout(self)
        top_panel_layout.setAlignment(Qt.AlignTop | Qt.AlignHCenter)  # Align top and center horizontally

        self.time_label = QLabel("01:32:44", self)
        self.time_label.setStyleSheet("color: white; font-size: 44px; font-weight: 600;")
        top_panel_layout.addWidget(self.time_label)

        top_panel_layout.addSpacing(10)

        self.logout_button = QPushButton("Logout", self)
        self.logout_button.setStyleSheet("""
            color: white;
            background-color: #6439B4;
            border: 1px solid #8160C7;
            border-radius: 8px;
            font-size: 18px;
            padding: 10px;
            font-style: normal;
            font-weight: 500;
            line-height: normal;                                         
        """)
        top_panel_layout.addWidget(self.logout_button)

        self.setLayout(top_panel_layout)

        self.adjustSize()  