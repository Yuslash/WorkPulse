from PyQt5.QtWidgets import QApplication, QWidget, QVBoxLayout
from PyQt5.QtCore import Qt, QPoint, QRectF
from PyQt5.QtGui import QPainter, QColor, QPainterPath, QPen, QFont
from components.TopPanel import TopPanel
from components.TrackingPanel import TrackingPanel
from components.ApplicationTable import ApplicationTable
from components.CustomButton import CustomButton

# Set the Jost font globally
app = QApplication([])

# Set the global font for the entire application
font = QFont("Jost")
app.setFont(font)

class MainWindow(QWidget):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("My App")
        self.setFixedSize(337, 604)
        self.setContentsMargins(10, 10, 10, 30)

        # self.move(20, 20)

        # Frameless + transparent window
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setWindowFlag(Qt.FramelessWindowHint)

        # Add button
        self.top_panel = TopPanel()
        self.tracking_panel = TrackingPanel()
        self.application_table = ApplicationTable()
        self.add_button = CustomButton('View All Actvity')

        # Set the main layout for the window
        main_layout = QVBoxLayout(self)
        main_layout.addWidget(self.top_panel)
        main_layout.addWidget(self.tracking_panel)
        main_layout.addWidget(self.application_table)
        main_layout.addWidget(self.add_button)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(10)
        main_layout.addStretch()
        self.setLayout(main_layout)

        # For dragging
        self._mouse_pos = None

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        border_width = 3
        radius = 25

        rect = self.rect().adjusted(
            border_width // 2, border_width // 2,
            -border_width // 2, -border_width // 2
        )

        path = QPainterPath()
        path.addRoundedRect(QRectF(rect), radius, radius)

        # Fill background
        painter.setBrush(QColor(68, 28, 156))  # Solid purple
        painter.setPen(Qt.NoPen)
        painter.drawPath(path)

        # Border (💡 This is the fixed part)
        pen = QPen(QColor("#6239BE"))
        pen.setWidth(border_width)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)
        painter.drawPath(path)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._mouse_pos = event.globalPos() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, event):
        if self._mouse_pos is not None:
            self.move(event.globalPos() - self._mouse_pos)

    def mouseReleaseEvent(self, event):
        self._mouse_pos = None

if __name__ == '__main__':
    window = MainWindow()
    window.show()

    app.exec_()
