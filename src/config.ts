import * as fs from "fs";
import * as yaml from "yaml";

export interface IBrowserProfileConfig {
  strategy?: "system" | "local";
  userDataDir?: string;
  profileDirectory?: string;
}

export interface IQuizConfig {
  mode?: "manual" | "semi-auto";
  videoPreviewSeconds?: number;
  llmEnabled?: boolean;
  only?: boolean;
  forceRunWhenFull?: boolean;
  testRounds?: number;
  stopAtFirstBlankForDebug?: boolean;
}

export type IExamConfig = IQuizConfig;

export interface IConfig {
  viewport: { width: number; height: number };
  chromePath?: string;
  browserProfile?: IBrowserProfileConfig;
  logRetentionDays?: number;
  quiz?: IQuizConfig;
  exam?: IQuizConfig;
}

const DEFAULT_CONFIG = `viewport:
  width: 1920
  height: 1080
browserProfile:
  strategy: system
  profileDirectory: Default
logRetentionDays: 365
quiz:
  mode: manual
  videoPreviewSeconds: 20
  llmEnabled: true
  only: false
  forceRunWhenFull: false
  testRounds: 3
  stopAtFirstBlankForDebug: false
`;

function applyDefaults(config: Partial<IConfig> | null | undefined): IConfig {
  const quizConfig = config?.quiz ?? config?.exam;
  return {
    viewport: {
      width: config?.viewport?.width ?? 1920,
      height: config?.viewport?.height ?? 1080,
    },
    chromePath: config?.chromePath,
    browserProfile: {
      strategy: config?.browserProfile?.strategy ?? "system",
      userDataDir: config?.browserProfile?.userDataDir,
      profileDirectory: config?.browserProfile?.profileDirectory ?? "Default",
    },
    logRetentionDays: config?.logRetentionDays ?? 365,
    quiz: {
      mode: quizConfig?.mode ?? "manual",
      videoPreviewSeconds: quizConfig?.videoPreviewSeconds ?? 20,
      llmEnabled: quizConfig?.llmEnabled ?? true,
      only: quizConfig?.only ?? false,
      forceRunWhenFull: quizConfig?.forceRunWhenFull ?? false,
      testRounds: quizConfig?.testRounds ?? 3,
      stopAtFirstBlankForDebug: quizConfig?.stopAtFirstBlankForDebug ?? false,
    },
  };
}

export function loadConfig(path: string = "config.yaml"): IConfig {
  if (!fs.existsSync(path)) {
     fs.writeFileSync(path, DEFAULT_CONFIG);
  }
  const file = fs.readFileSync(path, 'utf8');
  return applyDefaults(yaml.parse(file) as Partial<IConfig>);
}
