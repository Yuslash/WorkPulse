from PyQt5.QtWidgets import QWidget, QLabel, QVBoxLayout, QHBoxLayout, QSizePolicy

class TrackingPanel(QWidget):
    def __init__(self):
        super().__init__()

        main_layout = QVBoxLayout()
        main_layout.setContentsMargins(0, 20, 0, 0)
        main_layout.setSpacing(8)  # Space between "Tracking" and inner container


        # "Tracking" label
        tracking_label = QLabel("Tracking", self)
        tracking_label.setStyleSheet("""
            color: #C0B6F2;
            font-size: 16px;
            font-weight: 500;
        """)
        main_layout.addWidget(tracking_label)

        # Inner container with background
        inner_container = QWidget(self)
        inner_container.setStyleSheet("""
            background-color: #3A1783;
            border-radius: 10px;
            padding: 12px;
        """)
        inner_container.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)

        inner_layout = QVBoxLayout(inner_container)
        inner_layout.setContentsMargins(0, 0, 0, 0)
        inner_layout.setSpacing(0)  # Small space between "Current App" and Idle layout

        # "Current App" label
        current_app = QLabel("Current App", self)
        current_app.setStyleSheet("""
            color: #FFFFFF;
            font-size: 16px;
            font-weight: 500;
        """)
        inner_layout.addWidget(current_app)

        # Idle time layout (horizontal)
        idle_time_layout = QHBoxLayout()
        idle_time_layout.setContentsMargins(0, 0, 0, 0)

        idle_label = QLabel("Idle Time", self)
        idle_label.setStyleSheet("""
            color: #FFFFFF;
            font-size: 16px;
            font-weight: 500;
        """)
        idle_time_layout.addWidget(idle_label)

        idle_time_layout.addStretch()

        idle_time = QLabel("00:19:22", self)
        idle_time.setStyleSheet("""
            color: #FFFFFF;
            font-size: 16px;
            font-weight: 500;
        """)
        idle_time_layout.addWidget(idle_time)

        inner_layout.addLayout(idle_time_layout)
        main_layout.addWidget(inner_container)

        self.setLayout(main_layout)
        self.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Minimum)
        self.adjustSize()
