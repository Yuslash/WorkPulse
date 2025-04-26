from PyQt5.QtWidgets import QWidget, QLabel, QVBoxLayout, QHBoxLayout, QSizePolicy

class ApplicationTable(QWidget):
    def __init__(self):
        super().__init__()

        main_layout = QVBoxLayout()
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(10)

        # "Application" title (no background)
        title_label = QLabel("Application", self)
        title_label.setStyleSheet("""
            color: #C0B6F2;
            font-size: 18px;
            font-weight: bold;
        """)
        main_layout.addWidget(title_label)

        # 👉 Container for table (header + rows)
        table_container = QWidget(self)
        table_container.setStyleSheet("""
            background-color: #3A1783;
            border-radius: 10px;
            padding: 10px;
        """)
        table_layout = QVBoxLayout(table_container)
        table_layout.setContentsMargins(0, 0, 0, 0)
        table_layout.setSpacing(10)

        # Table header
        header_layout = QHBoxLayout()
        header_layout.setSpacing(20)

        name_header = QLabel("Name", self)
        name_header.setStyleSheet(self._header_style())
        header_layout.addWidget(name_header)

        opened_header = QLabel("Opened", self)
        opened_header.setStyleSheet(self._header_style())
        header_layout.addWidget(opened_header)

        closed_header = QLabel("Closed", self)
        closed_header.setStyleSheet(self._header_style())
        header_layout.addWidget(closed_header)

        table_layout.addLayout(header_layout)

        # Example rows (you can later dynamically add more rows)
        for app_name, opened, closed in [
            ("Chrome", "12:00 PM", "01:00 PM"),
            ("VS Code", "01:10 PM", "03:00 PM"),
        ]:
            row_layout = QHBoxLayout()
            row_layout.setSpacing(20)

            name_label = QLabel(app_name, self)
            name_label.setStyleSheet(self._row_style())
            row_layout.addWidget(name_label)

            opened_label = QLabel(opened, self)
            opened_label.setStyleSheet(self._row_style())
            row_layout.addWidget(opened_label)

            closed_label = QLabel(closed, self)
            closed_label.setStyleSheet(self._row_style())
            row_layout.addWidget(closed_label)

            table_layout.addLayout(row_layout)

        # Add table container to the main layout
        main_layout.addWidget(table_container)

        self.setLayout(main_layout)
        self.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Minimum)
        self.adjustSize()

    def _header_style(self):
        return """
            color: #FFFFFF;
            font-size: 14px;
            font-weight: 600;
        """

    def _row_style(self):
        return """
            color: #DDDDDD;
            font-size: 13px;
            font-weight: 400;
        """
