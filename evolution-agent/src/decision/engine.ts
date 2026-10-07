import { ModelProvider } from '../models/provider.js';
import { choice, score, noul, DecisionResult } from './primitives.js';
import { ChoiceOutput, RiskLevel, ActionType, Candidate } from './schemas.js';

export interface DecisionEngineConfig {
  temperatureScale: number;
  lowRiskThreshold: number;
  mediumRiskThreshold: number;
  highRiskThreshold: number;
}

const DEFAULT_CONFIG: DecisionEngineConfig = {
  temperatureScale: 1.0,
  lowRiskThreshold: 0.75,
  mediumRiskThreshold: 0.85,
  highRiskThreshold: 0.95, // High risk requires very high confidence, maybe just routes to human
};

export class DecisionEngine {
  private primaryProvider: ModelProvider;
  private secondaryProvider?: ModelProvider;
  private config: DecisionEngineConfig;

  constructor(
    primary: ModelProvider,
    secondary?: ModelProvider,
    config: Partial<DecisionEngineConfig> = {}
  ) {
    this.primaryProvider = primary;
    this.secondaryProvider = secondary;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generates a choice decision to select the best candidate.
   * Maps confidence and risk into a final ActionType.
   */
  async evaluateCandidates(
    candidates: Candidate[],
    prompt: string,
    actionRisk: RiskLevel
  ): Promise<{
    action: ActionType;
    decision: DecisionResult<ChoiceOutput>;
    secondaryInvoked: boolean;
    verified: boolean;
  }> {
    if (candidates.length === 0) {
      throw new Error("No candidates provided for evaluation.");
    }
    
    if (candidates.length === 1) {
       // Trivially, if only 1 candidate, we could just return it, 
       // but typically we'd use `score` or `noul` to verify it. 
       // For now, let's let it run through choice if passed.
    }

    // 1. Primary Model Decision
    const decision = await choice(this.primaryProvider, prompt, this.config.temperatureScale);
    let action: ActionType = 'abstain';
    let secondaryInvoked = false;
    let verified = false;

    // 2. Risk-based Routing
    switch (actionRisk) {
      case 'CRITICAL':
        // Critical actions are NEVER autonomous.
        action = 'human';
        break;

      case 'HIGH':
        if (decision.confidence >= this.config.highRiskThreshold) {
          action = 'human'; // Still routes to human even with high confidence, but flags as recommended
        } else {
          action = 'abstain';
        }
        break;

      case 'MEDIUM':
        if (decision.confidence >= this.config.mediumRiskThreshold) {
          if (this.secondaryProvider) {
            secondaryInvoked = true;
            // For now, secondary verification uses the same prompt.
            // In a full implementation, it might use a simplified binary prompt.
            const secDecision = await choice(this.secondaryProvider, prompt, 0.1); // low temp for verifier
            if (secDecision.selectedIdx === decision.selectedIdx) {
              verified = true;
              action = 'execute';
            } else {
              action = 'abstain';
            }
          } else {
            // No secondary provider available, fallback to abstain or human
            action = 'human';
          }
        } else {
          action = 'abstain';
        }
        break;

      case 'LOW':
        if (decision.confidence >= this.config.lowRiskThreshold) {
          action = 'execute';
        } else {
          action = 'abstain';
        }
        break;
    }

    return {
      action,
      decision,
      secondaryInvoked,
      verified,
    };
  }
}
