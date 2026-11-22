# 驾驶 bot（游戏模拟）

> [!IMPORTANT]
> **状态**
> - 现在只能练习和提交。
> - 正式计分还在接，暂时出不了成绩。
> - 不承诺任何时间。

本仓库不是完整的迷你赛车游戏。公开仓库：https://github.com/wonder07090518-dot/mini-formula-ai-arena 。
操作员入口目前只提供 study 冒烟检查；私人引擎计分尚未实现。

参照 [API](docs/ai-arena-bot-api.ts) 和[说明](docs/ai-arena-bot-prompt.md)，
编写一个确定性的单文件 TypeScript bot。每一帧收到只读视图，返回 `throttle`、
`brake`、`steer`。有限值分别限制在 [0, 1]、[0, 1]、[-1, 1]；非有限值归零。
预期在隔离子进程中运行，每帧墙钟时间预算为 20 毫秒；超时或异常时使用全零
控制并计数。禁止文件系统、网络、子进程及运行时导入。完整约束以说明为准。

[本地练习计分器](practice/README.md)仅含 study 干地，默认 orbit 车型、club 难度和一圈。
先运行 `npm ci`，然后运行：

```sh
npm start -- --bot examples/noop-bot.ts --track study --seed 7 --laps 1 --weather dry
```

种子 7 是练习种子，与第二场种子不同；本包不含未来正式种子和正式赛道几何。
练习不是正式成绩。

可使用模板通过公开 GitHub PR 或 issue 免费提交单文件 bot。
每份接受的提交计划使用新派生的种子；可审计的算法见[种子派生](docs/seed-derivation.md)。

第二场每次撞墙加 0.5 秒：撞墙是 `physics.barrierContact` 的上升沿，记录为
`wallHitCount`。持续接触只算一次，分离后再次接触再算一次。罚时后总时间为
`totalTime + 0.5 * wallHitCount`。历史数字和说明见[第二场参考](docs/round2-reference.md)。
