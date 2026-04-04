import { describe, expect, test } from "bun:test";
import {
  applySuggestedAnswers,
  deriveBlankSuggestion,
  deriveChoiceSuggestions,
  deriveOrderedBlankSuggestions,
  hasAdvancedToDifferentQuestion,
  matchSuggestedOptions,
  normalizeQuizText,
  parseQuestionFromRawText,
  pickSingleBlankFromHighlights,
  resolveQuestionTypeFromSnapshot,
  sortVisualSlots,
  tokenizeBlankAnswerByCandidates,
} from "../src/tasks/quiz_helpers";

describe("quiz helpers", () => {
  test("normalizes quiz text whitespace", () => {
    expect(normalizeQuizText("  a \n  b   ")).toBe("a b");
  });

  test("derives matching choice suggestions from hint text", () => {
    const options = ["A. 中国梦", "B. 新质生产力", "C. 乡村振兴"];
    const hint = "提示：要加快发展新质生产力，推动高质量发展。";
    expect(deriveChoiceSuggestions(options, hint)).toEqual(["B. 新质生产力"]);
  });

  test("derives single-character chinese option from hint text", () => {
    const options = ["A. 纱", "B. 绢", "C. 绸", "D. 锦"];
    const hint = "锦是以彩色丝线织出斜纹重经组织的高级提花织物。";
    expect(deriveChoiceSuggestions(options, hint)).toEqual(["D. 锦"]);
  });

  test("derives blank suggestions from quoted hint text first", () => {
    const hint = "提示中提到“两个结合”是推进理论创新的重要方法。";
    expect(deriveBlankSuggestion(hint)).toEqual(["两个结合"]);
  });

  test("derives ordered blank suggestions from hint text using stem context", () => {
    const stem = "红绿彩塑像彩绘以（）色为主，（）色为辅。";
    const hint = "八义窑红绿彩瓷制作技艺中，红绿彩塑像彩绘以红色为主，绿色为辅，形成鲜明装饰风格。";
    expect(deriveOrderedBlankSuggestions(stem, hint, 2)).toEqual(["红", "绿"]);
  });

  test("derives single blank suggestion from matching sentence context", () => {
    const stem = "小穿芳峪村位于天津市蓟州区东北部，始建于（）初期。";
    const hint = "小穿芳峪村位于天津市蓟州区东北部，始建于明朝初期。村落“隐士文化”“园林文化”历史悠久。";
    expect(deriveOrderedBlankSuggestions(stem, hint, 1)).toEqual(["明朝"]);
  });

  test("derives single blank suggestion by diff when stem has no placeholder", () => {
    const stem = "2014年6月，习近平总书记对禁毒工作作出重要指示强调，各级党委和政府要深刻认识毒品问题的危害性、深刻认识做好禁毒工作的重要性，以对人民的精神，加强组织领导，采取有力措施，持之以恒把禁毒工作深入开展下去。";
    const hint = "2014年6月，习近平总书记对禁毒工作作出重要指示强调，各级党委和政府要深刻认识毒品问题的危害性、深刻认识做好禁毒工作的重要性，以对人民高度负责的精神，加强组织领导，采取有力措施，持之以恒把禁毒工作深入开展下去。";
    expect(deriveOrderedBlankSuggestions(stem, hint, 1)).toEqual(["高度负责"]);
  });

  test("derives single blank suggestion from long hint text without falling back to the whole sentence", () => {
    const stem = "2025年4月25日，习近平在中共二十届中央政治局第二十次集体学习时指出，要推动人工智能科技创新与产业创新深度融合，构建主导的产学研用协同创新体系，助力传统产业改造升级，开辟战略性新兴产业和未来产业发展新赛道。统筹推进算力基础设施建设，深化数据资源开发利用和开放共享。";
    const hint = "2025年4月25日，习近平在中共二十届中央政治局第二十次集体学习时指出，我国数据资源丰富，产业体系完备，应用场景广阔，市场空间巨大。要推动人工智能科技创新与产业创新深度融合，构建企业主导的产学研用协同创新体系，助力传统产业改造升级，开辟战略性新兴产业和未来产业发展新赛道。统筹推进算力基础设施建设，深化数据资源开发利用和开放共享。";
    expect(deriveOrderedBlankSuggestions(stem, hint, 1)).toEqual(["企业"]);
  });

  test("derives compact phrase for multi-slot click blank without falling back to the whole sentence", () => {
    const stem = "天津市蓟州区隆福寺村成村于乾隆九年，因修建隆福寺行宫得名。村内保留有两处满族风情传统民居，是天津市唯一少数民族乡——满族乡中七个满族聚居村之一。2023年，隆福寺村入选第六批中国传统村落名录。";
    const hint = "天津市蓟州区隆福寺村成村于乾隆九年，因修建隆福寺行宫得名。村内保留有两处满族风情传统民居，是天津市唯一少数民族乡——孙各庄满族乡中七个满族聚居村之一。2023年，隆福寺村入选第六批中国传统村落名录。";
    expect(deriveOrderedBlankSuggestions(stem, hint, 3)).toEqual(["孙各庄"]);
  });

  test("parses multiple-choice question stem and options from raw text", () => {
    const raw = `学习强国>>我的学习>>我要答题>>每日答题>>
1/5
多选题
习近平在党的二十大报告中指出，解决台湾问题、实现祖国完全统一，是党矢志不渝的（），是全体中华儿女的共同愿望。
来源：习近平在中国共产党第二十次全国代表大会上的报告
查看提示
A. 历史任务
B. 必然要求
C. 总体方略
D. 主导权和主动权
出题：“学习强国”学习平台`;

    expect(parseQuestionFromRawText(raw)).toEqual({
      stem: "习近平在党的二十大报告中指出，解决台湾问题、实现祖国完全统一，是党矢志不渝的（），是全体中华儿女的共同愿望。",
      options: ["A. 历史任务", "B. 必然要求", "C. 总体方略", "D. 主导权和主动权"],
      questionType: "multiple",
    });
  });

  test("parses single-choice options from compact raw text", () => {
    const raw = "2/5单选题新时代十年伟大变革具有里程碑意义。A. 正确B. 错误查看提示确定";
    expect(parseQuestionFromRawText(raw)).toEqual({
      stem: "新时代十年伟大变革具有里程碑意义。",
      options: ["A. 正确", "B. 错误"],
      questionType: "single",
    });
  });

  test("matches suggestions against full option text", () => {
    expect(matchSuggestedOptions(["A. 红 绿", "B. 绿 红"], ["A. 红 绿"])).toEqual(["A. 红 绿"]);
  });

  test("matches suggestions against option body without label", () => {
    expect(matchSuggestedOptions(["A. 正确", "B. 错误"], ["错误"])).toEqual(["B. 错误"]);
  });

  test("matches letter-only suggestion to option label", () => {
    expect(matchSuggestedOptions(["A. 第一时间上报", "B. 擅自处理"], ["A"])).toEqual(["A. 第一时间上报"]);
  });

  test("single-choice ambiguity should stay ambiguous at matching layer", () => {
    expect(matchSuggestedOptions(["A. 某械注册", "B. 卫食健字"], ["A. 某械注册", "B. 卫食健字"])).toEqual([
      "A. 某械注册",
      "B. 卫食健字",
    ]);
  });

  test("matches all suggested multi-choice options", () => {
    expect(
      matchSuggestedOptions(
        ["A. 紧邻草丛随地烧纸", "B. 在火堆余烬彻底熄灭前离开", "C. 冒风紧邻机动车烧纸"],
        ["A. 紧邻草丛随地烧纸", "B. 在火堆余烬彻底熄灭前离开", "C. 冒风紧邻机动车烧纸"]
      )
    ).toEqual([
      "A. 紧邻草丛随地烧纸",
      "B. 在火堆余烬彻底熄灭前离开",
      "C. 冒风紧邻机动车烧纸",
    ]);
  });

  test("applies each matched multi-choice text only once when DOM contains duplicate nodes", async () => {
    class FakeNode {
      constructor(
        readonly text: string,
        readonly box: { x: number; y: number; width: number; height: number; }
      ) {}

      async boundingBox() {
        return this.box;
      }

      async evaluate<T>(_pageFunction: (element: Element) => T | Promise<T>) {
        return undefined as T;
      }
    }

    class FakePage {
      selected = new Set<string>();
      lastPoint = { x: 0, y: 0 };

      constructor(readonly nodes: FakeNode[]) {}

      mouse = {
        move: async (x: number, y: number) => {
          this.lastPoint = { x, y };
        },
        down: async () => undefined,
        up: async () => {
          const hit = this.nodes.find((node) => {
            const { x, y, width, height } = node.box;
            return (
              this.lastPoint.x >= x &&
              this.lastPoint.x <= x + width &&
              this.lastPoint.y >= y &&
              this.lastPoint.y <= y + height
            );
          });
          if (!hit) return;
          if (this.selected.has(hit.text)) {
            this.selected.delete(hit.text);
          } else {
            this.selected.add(hit.text);
          }
        },
      };

      async $$(selector: string) {
        if (selector !== ".q-answer.choosable, .q-answer") {
          return [];
        }
        return this.nodes;
      }

      async evaluate<T>(_pageFunction: unknown, arg?: unknown) {
        if (arg instanceof FakeNode) {
          return arg.text as T;
        }
        if (typeof arg === "string") {
          return this.selected.has(arg) as T;
        }
        return undefined as T;
      }
    }

    const page = new FakePage([
      new FakeNode("A. 鲜花祭祀", { x: 10, y: 10, width: 80, height: 20 }),
      new FakeNode("A. 鲜花祭祀", { x: 10, y: 40, width: 80, height: 20 }),
      new FakeNode("B. 植树缅怀", { x: 10, y: 70, width: 80, height: 20 }),
      new FakeNode("C. 家庭追思", { x: 10, y: 100, width: 80, height: 20 }),
    ]);

    const applied = await applySuggestedAnswers(
      page as never,
      {
        stem: "现如今，倡导采用（）、（）、（）等方式，文明祭扫、绿色追思。",
        options: ["A. 鲜花祭祀", "B. 植树缅怀", "C. 家庭追思"],
        questionType: "multiple",
        blankCount: 0,
        hasVideo: false,
        currentIndex: 1,
        totalQuestions: 5,
      },
      ["A. 鲜花祭祀", "B. 植树缅怀", "C. 家庭追思"],
      async () => undefined
    );

    expect(applied).toEqual(["A. 鲜花祭祀", "B. 植树缅怀", "C. 家庭追思"]);
    expect(Array.from(page.selected)).toEqual(["A. 鲜花祭祀", "B. 植树缅怀", "C. 家庭追思"]);
  });

  test("tokenizes blank answer by candidate chips", () => {
    const candidates = ["党中央决策部署", "落实", "贯彻"];
    expect(tokenizeBlankAnswerByCandidates("贯彻落实党中央决策部署", candidates)).toEqual([
      "贯彻",
      "落实",
      "党中央决策部署",
    ]);
  });

  test("tokenizes multi-word fill-answer candidates in hint order", () => {
    const candidates = ["保密", "国家级"];
    expect(tokenizeBlankAnswerByCandidates("国家级保密", candidates)).toEqual([
      "国家级",
      "保密",
    ]);
  });

  test("tokenizes mixed-length click-blank candidates, not only single characters", () => {
    const candidates = ["张三", "李四", "赵二麻子"];
    expect(tokenizeBlankAnswerByCandidates("张三李四赵二麻子", candidates)).toEqual([
      "张三",
      "李四",
      "赵二麻子",
    ]);
  });

  test("treats unchanged quiz snapshot as not advanced", () => {
    expect(hasAdvancedToDifferentQuestion(
      { stem: "屯留道情是主要流行于晋东南地区……多为（）演出。", currentIndex: 4 },
      { stem: "屯留道情是主要流行于晋东南地区……多为（）演出。", currentIndex: 4 },
    )).toBe(false);
  });

  test("treats changed quiz index or stem as advanced", () => {
    expect(hasAdvancedToDifferentQuestion(
      { stem: "上一题", currentIndex: 4 },
      { stem: "下一题", currentIndex: 4 },
    )).toBe(true);

    expect(hasAdvancedToDifferentQuestion(
      { stem: "上一题", currentIndex: 4 },
      { stem: "上一题", currentIndex: 5 },
    )).toBe(true);
  });

  test("sorts blank slots by visual order instead of DOM order", () => {
    expect(sortVisualSlots([
      { x: 120, y: 80, text: "第三空" },
      { x: 40, y: 80, text: "第一空" },
      { x: 80, y: 80, text: "第二空" },
      { x: 20, y: 108, text: "下一行" },
    ])).toEqual([
      { x: 40, y: 80, text: "第一空" },
      { x: 80, y: 80, text: "第二空" },
      { x: 120, y: 80, text: "第三空" },
      { x: 20, y: 108, text: "下一行" },
    ]);
  });

  test("prefers choice question type when options exist even if visual blanks are detected", () => {
    expect(resolveQuestionTypeFromSnapshot({
      parsedQuestionType: "unknown",
      parsedOptionsCount: 3,
      selectorOptionsCount: 3,
      inputBlankCount: 0,
      visualBlankCount: 3,
    })).toBe("multiple");

    expect(resolveQuestionTypeFromSnapshot({
      parsedQuestionType: "multiple",
      parsedOptionsCount: 3,
      selectorOptionsCount: 3,
      inputBlankCount: 0,
      visualBlankCount: 3,
    })).toBe("multiple");
  });

  test("treats parsed blank question as single blank when only one real blank is detected", () => {
    expect(resolveQuestionTypeFromSnapshot({
      parsedQuestionType: "single_blank",
      parsedOptionsCount: 0,
      selectorOptionsCount: 0,
      inputBlankCount: 0,
      visualBlankCount: 1,
    })).toBe("single_blank");
  });

  test("picks the most plausible single-blank highlight instead of the whole sentence", () => {
    const stem = "2026年1月15日起，铁路部门在东北环线6趟列车试点推出“便利行”服务，旅客可随车携带雪具并存放在列车指定位置，让“乘着高铁去滑雪”更加方便快捷。";
    const hint = "2026年1月15日起，铁路部门在东北环线6趟列车试点推出“雪具便利行”服务，旅客可随车携带雪具并存放在列车指定位置，让“乘着高铁去滑雪”更加方便快捷。";
    expect(pickSingleBlankFromHighlights(stem, hint, ["雪具", "滑雪"])).toBe("滑雪");
  });
});
