# 项目Model同步本地JSON

- 类型：完整流程，存储改动。
- 目标：完整项目Model每次提交后同步到projects/<项目ID>/project.json。
- 非目标：JSON不作为第二套写入入口，不包含任务历史/模型密钥，不修改项目业务数据。

## 验收标准
- AC-1：创建项目、更新任意字段后JSON与Model及SQLite项目内容相等。
- AC-2：每项目串行、原子替换JSON，失败事务不覆盖JSON；任务历史不混入项目JSON。
- AC-3：启动时从SQLite补齐/修复既有项目JSON，数据库提交后进程中断可恢复；删除项目一并删除JSON。
- AC-4：JSON写入失败不伪造数据库回滚，内存仍反映已提交结果；更新返回storage_warning，幂等重试重新同步且不重复业务变更。

## 调用链和影响
ProjectModel.update → ModelRepository.#commit → SQLiteStore.write → 更新内存/本地JSON → change事件。
create和启动恢复同样同步。GitNexus ModelRepository影响LOW，涉及runtime与插件入口；私有事务分支已逐一读源码确认。

## 改动
- server/data/model-repository.js：同步文件及启动回填，保留数据库唯一来源、原事务与版本冲突机制。
- tests/stage02-project-json.test.js：任意字段、时长、串行、回滚、写入失败与幂等恢复、重启恢复、删除。
- 存储文档和开发指引同步。

## 验证
基线415项，413通过、2既有失败、0取消。完成后全量比较、差异检查与图谱更新。

## 验证结果
AC-1至AC-4通过。新增4项镜像测试，原SQLite真实进程崩溃测试增加JSON恢复断言。全量419项417通过、2既有失败、0取消；最终提交顺序微调后8项存储测试全通过。实际数据库只读副本1个项目已生成镜像并逐字段核对一致。当前有运行任务，未重启线上服务。
