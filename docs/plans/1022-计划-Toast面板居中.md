# Toast 面板居中

- 类型：小改动，两个实现文件；公共容器方案仅评估，不新增页面框架。
- 目标：toast在现有右侧面板中央、最高局部层显示，保留showToast(message)调用。
- 非目标：不新建空白页面、不迁移布局、不改复制行为。

## 改动与验收
- AC-1：packages/ui增加一次性的容器登记；showToast将提示挂在容器直接子级，用绝对定位与50%/50%居中，层级2147483647，不进入内容滚动区。面板尺寸变化仍居中。
- AC-2：Drama panel-shell建立时登记sidebar，销毁时解除；未登记/容器已移除时默认页面中央，仍2.5秒关闭、连续提示替换。
- AC-3：提示不拦截点击、普通弹窗下仍可见；按钮调用仍只传文字，不创建tests目录。
- GitNexus showToast LOW，2直接调用方/1流程。createShell UNKNOWN，源码确认panel.js动态import及已有panel-shell测试；不是无使用。改前索引仅文档过期，已刷新。

## 验证
既有面板及Drama测试；临时JSDOM验证挂载位置、定位样式、最高局部层、无指针拦截、替换和自动关闭、解除后回退。浏览器资源遍历继续验证新增公共包导入。

## 验证结果
- 基线/改后Drama均167通过、0失败、0 cancelled；浏览器资源递归加载覆盖新setToastContainer导入。
- 临时JSDOM烟测通过：toast为sidebar直接子级、非workspace-content子级，绝对定位50%/50%、translate(-50%,-50%)、z-index2147483647、pointer-events:none；重复替换、2.5秒自动移除、销毁后页面中央回退均通过。没有增加测试目录。
- 既有面板测试覆盖拖动/键盘调宽和折叠；百分比定位保持随容器居中。未做人工像素验收。
- git diff --check通过；累计detect_changes含前序未提交差异，critical，无partial/truncated；本轮showToast影响LOW，createShell动态入口已源码核对。
- verify:install通过；最终force图谱更新成功（11314节点、31735边）；无需重启，刷新浏览器加载新UI资源。
