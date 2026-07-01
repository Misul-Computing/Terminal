import type { Model, Usage } from "@misul/ai";

export interface TurnUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheWrite1h?: number;
}

export interface ToolCallDistribution {
	[toolName: string]: number;
}

export interface TelemetryStats {
	turns: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cacheHitRate: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	estimatedNoCacheCost: number;
	savings: number;
	toolCalls: number;
	toolDistribution: ToolCallDistribution;
	averageTokensPerTurn: number;
	durationMs: number;
}

export interface RunTelemetryOptions {
	model?: Model<any>;
	startTime?: number;
}

const COST_PER_MILLION = 1000000;

export class RunTelemetry {
	private _model: Model<any> | undefined;
	private _startTime: number;
	private _turns = 0;
	private _input = 0;
	private _output = 0;
	private _cacheRead = 0;
	private _cacheWrite = 0;
	private _cacheWrite1h = 0;
	private _costInput = 0;
	private _costOutput = 0;
	private _costCacheRead = 0;
	private _costCacheWrite = 0;
	private _estimatedNoCacheCost = 0;
	private _toolCalls = 0;
	private _toolDistribution: ToolCallDistribution = {};

	constructor(options: RunTelemetryOptions = {}) {
		this._model = options.model;
		this._startTime = options.startTime ?? Date.now();
	}

	setModel(model: Model<any> | undefined): void {
		this._model = model;
	}

	recordTurn(usage: TurnUsage | Usage): void {
		this._turns++;
		this._input += usage.input;
		this._output += usage.output;
		this._cacheRead += usage.cacheRead;
		this._cacheWrite += usage.cacheWrite;
		if ("cacheWrite1h" in usage && usage.cacheWrite1h) {
			this._cacheWrite1h += usage.cacheWrite1h;
		}

		const model = this._model;
		if (model) {
			const longWrite = ("cacheWrite1h" in usage ? usage.cacheWrite1h : 0) ?? 0;
			const shortWrite = usage.cacheWrite - longWrite;
			this._costInput += (model.cost.input / COST_PER_MILLION) * usage.input;
			this._costOutput += (model.cost.output / COST_PER_MILLION) * usage.output;
			this._costCacheRead += (model.cost.cacheRead / COST_PER_MILLION) * usage.cacheRead;
			this._costCacheWrite +=
				(model.cost.cacheWrite * shortWrite + model.cost.input * 2 * longWrite) / COST_PER_MILLION;

			const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
			this._estimatedNoCacheCost += (promptTokens * model.cost.input) / COST_PER_MILLION;
		}
	}

	recordToolCall(toolName: string): void {
		this._toolCalls++;
		this._toolDistribution[toolName] = (this._toolDistribution[toolName] ?? 0) + 1;
	}

	getStats(): TelemetryStats {
		const totalTokens = this._input + this._output + this._cacheRead + this._cacheWrite;
		const promptTokens = this._input + this._cacheRead + this._cacheWrite;
		const cacheHitRate = promptTokens > 0 ? (this._cacheRead / promptTokens) * 100 : 0;
		const costTotal = this._costInput + this._costOutput + this._costCacheRead + this._costCacheWrite;
		const durationMs = Date.now() - this._startTime;

		return {
			turns: this._turns,
			tokens: {
				input: this._input,
				output: this._output,
				cacheRead: this._cacheRead,
				cacheWrite: this._cacheWrite,
				total: totalTokens,
			},
			cacheHitRate,
			cost: {
				input: this._costInput,
				output: this._costOutput,
				cacheRead: this._costCacheRead,
				cacheWrite: this._costCacheWrite,
				total: costTotal,
			},
			estimatedNoCacheCost: this._estimatedNoCacheCost,
			savings: this._estimatedNoCacheCost - costTotal,
			toolCalls: this._toolCalls,
			toolDistribution: { ...this._toolDistribution },
			averageTokensPerTurn: this._turns > 0 ? totalTokens / this._turns : 0,
			durationMs,
		};
	}

	reset(): void {
		this._startTime = Date.now();
		this._turns = 0;
		this._input = 0;
		this._output = 0;
		this._cacheRead = 0;
		this._cacheWrite = 0;
		this._cacheWrite1h = 0;
		this._costInput = 0;
		this._costOutput = 0;
		this._costCacheRead = 0;
		this._costCacheWrite = 0;
		this._estimatedNoCacheCost = 0;
		this._toolCalls = 0;
		this._toolDistribution = {};
	}
}
