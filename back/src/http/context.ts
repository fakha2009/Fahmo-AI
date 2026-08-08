import type { EnvConfig } from "../config";
import type { AnalysisEventStore } from "../modules/analysis/application/analysis-event-store";
import {
  PrismaAnalysisRepository,
  PrismaAnalysisEventStore,
  PrismaAnalysisInputRepository,
  PrismaAnalysisVersionRepository,
  PrismaExportJobRepository,
  PrismaIdempotencyRepository,
  PrismaJobRepository,
  PrismaPreferencesRepository,
  PrismaReminderRepository,
  PrismaSessionRepository,
  PrismaShareRepository,
  PrismaSourceAssetRepository,
  PrismaTaskRepository,
} from "../database/repositories";
import { EncryptingStorageAdapter, LocalStorageAdapter } from "../storage/adapters";
import type { StoragePort } from "../storage/contracts/storage-port";
import { FileLimits } from "../modules/ingestion/domain/types";
import {
  FileValidator,
  ImageProcessor,
  PdfProcessor,
  TemporaryStorageService,
  SourcePreviewService,
  IngestionService,
} from "../modules/ingestion/application";
import { createAiStack } from "../ai/composition";
import { AnalysisPipeline, ANALYSIS_QUEUE } from "../modules/analysis/application/analysis-pipeline";
import { AnalysisController } from "../modules/analysis/application/analysis-controller";
import { InProcessAnalysisEventHub } from "../modules/analysis/application/analysis-event-hub";
import { PersistedAnalysisEventPublisher } from "../modules/analysis/application/analysis-event-hub";
import { AnalysisWorker } from "../modules/analysis/application/analysis-worker";
import { SourceAssetService } from "../modules/preview/application/source-asset-service";
import { previewPolicyFor } from "../modules/preview/domain/policy";
import { ExportService } from "../modules/exports/application/export-service";
import { ShareService, ShareController } from "../modules/shares/application";
import { SessionService } from "../modules/identity/application/session-service";
import { IdempotencyService, hashRequest } from "../modules/idempotency/application";
import { TokenBucketRateLimiter } from "../modules/rate-limit/rate-limiter";
import { AnalysisTaskMaterializer, TaskService } from "../modules/tasks/application";
import { ReminderService } from "../modules/reminders/application";
import { PreferencesService } from "../modules/preferences/application";
import type { AiGateway } from "../ai/gateway/ai-gateway";
import type { ProviderRegistry } from "../ai/gateway/provider-registry";

export interface AppContext {
  config: EnvConfig;
  pipeline: AnalysisPipeline;
  analysisController: AnalysisController;
  analysisRepository: PrismaAnalysisRepository;
  analysisWorker: AnalysisWorker;
  inputRepository: PrismaAnalysisInputRepository;
  jobs: PrismaJobRepository;
  exportService: ExportService;
  taskService: TaskService;
  taskRepository: PrismaTaskRepository;
  reminderService: ReminderService;
  reminderRepository: PrismaReminderRepository;
  preferencesService: PreferencesService;
  sourceAssets: SourceAssetService;
  aiGateway: AiGateway;
  providerRegistry: ProviderRegistry;
  shareController: ShareController;
  shareService: ShareService;
  sessions: SessionService;
  idempotency: IdempotencyService;
  hub: InProcessAnalysisEventHub;
  eventStore: AnalysisEventStore;
  storage: StoragePort;
  rateLimiters: {
    createAnalysis: TokenBucketRateLimiter;
    general: TokenBucketRateLimiter;
  };
}

export interface CreateAppContextOptions {
  config: EnvConfig;
}

export function createAppContext(options: CreateAppContextOptions): AppContext {
  const config = options.config;
  const hub = new InProcessAnalysisEventHub();
  const eventStore = new PrismaAnalysisEventStore();

  const rawStorage = new LocalStorageAdapter(config.STORAGE_DIR);
  const storage: StoragePort = new EncryptingStorageAdapter(rawStorage, config.DATA_ENCRYPTION_KEY);

  const events = new PersistedAnalysisEventPublisher(
    eventStore,
    hub
  );
  const analysisRepository = new PrismaAnalysisRepository();
  const jobs = new PrismaJobRepository();

  const limits: FileLimits = {
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
    maxImageCount: config.MAX_IMAGE_COUNT,
    maxPdfPages: config.MAX_PDF_PAGES,
    maxTextLengthChars: config.MAX_TEXT_LENGTH,
  };
  const ingestion = new IngestionService(
    new FileValidator(limits),
    new ImageProcessor(),
    new PdfProcessor(),
    new TemporaryStorageService(storage),
    new SourcePreviewService(storage)
  );

  const ai = createAiStack(config);

  const assets = new SourceAssetService(
    new PrismaSourceAssetRepository(),
    analysisRepository,
    storage
  );

  const pipeline = new AnalysisPipeline({
    repository: analysisRepository,
    jobs,
    events,
    ingestion,
    gateway: ai.gateway,
    storage,
    assets,
  });

  const taskRepository = new PrismaTaskRepository();
  const reminderRepository = new PrismaReminderRepository();
  const preferencesRepository = new PrismaPreferencesRepository();
  const taskMaterializer = new AnalysisTaskMaterializer(taskRepository);
  const analysisWorker = new AnalysisWorker({
    pipeline,
    repository: analysisRepository,
    inputs: new PrismaAnalysisInputRepository(),
    jobs,
    storage,
    onCompleted: (analysis) => taskMaterializer.materialize(analysis),
  });
  const inputRepository = new PrismaAnalysisInputRepository();

  const exportService = new ExportService(
    new PrismaExportJobRepository(),
    {
      analysisRepository,
      taskRepository,
      reminderRepository,
      versionRepository: new PrismaAnalysisVersionRepository(),
      preferencesRepository,
    },
    storage
  );

  const sessions = new SessionService(new PrismaSessionRepository(), {
    ttlMs: config.ANONYMOUS_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  });

  const shareService = new ShareService(new PrismaShareRepository(), analysisRepository);

  const shareController = new ShareController(shareService);

  return {
    config,
    pipeline,
    analysisController: new AnalysisController({ pipeline, repository: analysisRepository }),
    analysisRepository,
    analysisWorker,
    inputRepository,
    jobs,
    exportService,
    taskService: new TaskService(taskRepository),
    taskRepository,
    reminderService: new ReminderService(reminderRepository, taskRepository),
    reminderRepository,
    preferencesService: new PreferencesService(preferencesRepository),
    sourceAssets: assets,
    aiGateway: ai.gateway,
    providerRegistry: ai.registry,
    shareController,
    shareService,
    sessions,
    idempotency: new IdempotencyService(new PrismaIdempotencyRepository()),
    hub,
    eventStore,
    storage,
    rateLimiters: {
      createAnalysis: new TokenBucketRateLimiter({ capacity: 10, refillRatePerSecond: 0.2 }),
      general: new TokenBucketRateLimiter({ capacity: 120, refillRatePerSecond: 4 }),
    },
  };
}

export { ANALYSIS_QUEUE, hashRequest, previewPolicyFor };
