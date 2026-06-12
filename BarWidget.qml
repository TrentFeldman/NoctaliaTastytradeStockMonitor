import QtQuick
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Widgets
import qs.Services.UI

Rectangle {
  id: root

  property var pluginApi: null
  property ShellScreen screen
  property string widgetId: ""
  property string section: ""
  property int sectionWidgetIndex: -1
  property int sectionWidgetsCount: 0

  property int count: pluginApi?.pluginSettings?.count || 0

  implicitWidth: row.implicitWidth + Style.marginM * 2
  implicitHeight: Style.barHeight
  color: Style.capsuleColor
  radius: Style.radiusM

  RowLayout {
    id: row
    anchors.centerIn: parent
    spacing: Style.marginS

    NIcon {
      icon: "numbers"
      color: Color.mPrimary
    }

    NText {
      text: root.count.toString()
      color: Color.mOnSurface
      pointSize: Style.fontSizeM
      font.weight: Font.Bold
    }
  }

  MouseArea {
    anchors.fill: parent
    onClicked: {
      root.count++
      pluginApi.pluginSettings.count = root.count
      pluginApi.saveSettings()
      ToastService.showNotice("Count: " + root.count)
    }
  }

  Component.onCompleted: {
    Logger.i("Counter", "Widget loaded with count:", root.count)
  }
}