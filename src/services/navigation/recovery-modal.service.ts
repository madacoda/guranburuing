// src/services/navigation/recovery-modal.service.ts
import { Page } from 'puppeteer-core';
import { IRecoveryModalService, ResourceRecoveryOutcome } from '../../domain/navigation/navigation.types.js';
import { logNormalDelay, humanReactionDelay } from '../../human-motor.js';

/**
 * Universal service for detecting and executing AP, EP, and Replicard AAP recovery modals.
 * Adheres to SRP: Exclusively handles resource recovery dialogs.
 */
export class RecoveryModalService implements IRecoveryModalService {
  constructor(private page: Page) {}

  public updatePage(page: Page): void {
    this.page = page;
  }

  /**
   * Handles AP recovery modal, consuming Half-Elixir if autoElixir is enabled.
   */
  public async handleApRecovery(autoElixir = true): Promise<ResourceRecoveryOutcome> {
    const isModalOpen = await this.page.evaluate(() => {
      const pop = document.querySelector('.pop-usual, .pop-show') as HTMLElement;
      if (!pop || pop.offsetParent === null) return false;
      const text = pop.innerText || '';
      const hasUseBtn = !!pop.querySelector('.btn-use-item, .btn-usual-use, .se-use');
      return (text.includes('AP') || text.includes('Elixir') || text.includes('回復') || text.includes('Recovery')) && hasUseBtn;
    }).catch(() => false);

    if (!isModalOpen) {
      return {
        resource: 'AP',
        wasRequired: false,
        recoverySuccessful: false,
        itemsUsed: 0,
        message: 'No AP recovery modal present.'
      };
    }

    if (!autoElixir) {
      console.warn('[RecoveryService] ⚠️ AP recovery needed, but autoElixir is disabled. Dismissing modal.');
      await this.dismissModal();
      return {
        resource: 'AP',
        wasRequired: true,
        recoverySuccessful: false,
        itemsUsed: 0,
        message: 'Auto-elixir disabled; recovery canceled.'
      };
    }

    console.log('[RecoveryService] 🧪 AP recovery needed. Consuming Half-Elixir...');
    const used = await this.executeItemUseAndConfirm();
    return {
      resource: 'AP',
      wasRequired: true,
      recoverySuccessful: used,
      itemsUsed: used ? 1 : 0,
      message: used ? 'Successfully consumed Half-Elixir.' : 'Failed to confirm item usage.'
    };
  }

  /**
   * Handles EP recovery modal, consuming Soul Berries if autoBerry is enabled.
   */
  public async handleEpRecovery(autoBerry = true): Promise<ResourceRecoveryOutcome> {
    const isModalOpen = await this.page.evaluate(() => {
      const pop = document.querySelector('.pop-usual, .pop-show') as HTMLElement;
      if (!pop || pop.offsetParent === null) return false;
      const text = pop.innerText || '';
      const hasUseBtn = !!pop.querySelector('.btn-use-item, .btn-usual-use, .se-use');
      return (text.includes('EP') || text.includes('Soul Berry') || text.includes('ソウルシード') || text.includes('回復')) && hasUseBtn;
    }).catch(() => false);

    if (!isModalOpen) {
      return {
        resource: 'EP',
        wasRequired: false,
        recoverySuccessful: false,
        itemsUsed: 0,
        message: 'No EP recovery modal present.'
      };
    }

    if (!autoBerry) {
      console.warn('[RecoveryService] ⚠️ EP recovery needed, but autoBerry is disabled. Dismissing modal.');
      await this.dismissModal();
      return {
        resource: 'EP',
        wasRequired: true,
        recoverySuccessful: false,
        itemsUsed: 0,
        message: 'Auto-berry disabled; recovery canceled.'
      };
    }

    console.log('[RecoveryService] 🫐 EP recovery needed. Consuming Soul Berry...');
    const used = await this.executeItemUseAndConfirm();
    return {
      resource: 'EP',
      wasRequired: true,
      recoverySuccessful: used,
      itemsUsed: used ? 1 : 0,
      message: used ? 'Successfully consumed Soul Berry.' : 'Failed to confirm item usage.'
    };
  }

  /**
   * Handles Replicard AAP recovery modal.
   */
  public async handleAapRecovery(): Promise<ResourceRecoveryOutcome> {
    const isModalOpen = await this.page.evaluate(() => {
      const pop = document.querySelector('.pop-usual, .pop-show') as HTMLElement;
      if (!pop || pop.offsetParent === null) return false;
      const text = pop.innerText || '';
      return (text.includes('AAP') || text.includes('回復') || text.includes('recover')) && !!pop.querySelector('.btn-use-item');
    }).catch(() => false);

    if (!isModalOpen) {
      return {
        resource: 'AAP',
        wasRequired: false,
        recoverySuccessful: false,
        itemsUsed: 0,
        message: 'No AAP recovery modal present.'
      };
    }

    console.log('[RecoveryService] ⏳ Replicard AAP recovery needed. Consuming item...');
    const used = await this.executeItemUseAndConfirm();
    return {
      resource: 'AAP',
      wasRequired: true,
      recoverySuccessful: used,
      itemsUsed: used ? 1 : 0,
      message: used ? 'Successfully replenished AAP.' : 'Failed to confirm AAP replenishment.'
    };
  }

  /**
   * Convenience dispatcher checking for any open recovery modal.
   */
  public async handleAnyRecovery(options: { autoElixir?: boolean; autoBerry?: boolean } = {}): Promise<ResourceRecoveryOutcome | null> {
    const modalType = await this.page.evaluate(() => {
      const pop = document.querySelector('.pop-usual, .pop-show') as HTMLElement;
      if (!pop || pop.offsetParent === null) return null;
      const text = pop.innerText || '';
      const hasUseBtn = !!pop.querySelector('.btn-use-item, .btn-usual-use, .se-use');
      if (!hasUseBtn) return null;

      if (text.includes('AAP')) return 'AAP';
      if (text.includes('EP') || text.includes('ソウル')) return 'EP';
      if (text.includes('AP') || text.includes('Elixir') || text.includes('エリクシール')) return 'AP';
      return 'AP'; // fallback default
    }).catch(() => null);

    if (!modalType) return null;

    if (modalType === 'AAP') return await this.handleAapRecovery();
    if (modalType === 'EP') return await this.handleEpRecovery(options.autoBerry ?? true);
    return await this.handleApRecovery(options.autoElixir ?? true);
  }

  private async executeItemUseAndConfirm(): Promise<boolean> {
    const itemClicked = await this.page.evaluate(() => {
      const useBtn = document.querySelector(
        '.pop-usual .btn-use-item, .pop-show .btn-use-item, .btn-use-item.btn-usual-use, .btn-usual-ok.se-use, .btn-use-item'
      ) as HTMLElement;
      if (useBtn && useBtn.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(useBtn).trigger('tap');
        useBtn.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (!itemClicked) return false;
    await logNormalDelay(400, 0.15);

    const okClicked = await this.page.evaluate(() => {
      const okBtn = document.querySelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, .btn-usual-ok') as HTMLElement;
      if (okBtn && okBtn.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(okBtn).trigger('tap');
        okBtn.click();
        return true;
      }
      return false;
    }).catch(() => false);

    await logNormalDelay(400, 0.15);
    return okClicked;
  }

  private async dismissModal(): Promise<void> {
    await this.page.evaluate(() => {
      const cancelBtn = document.querySelector(
        '.pop-usual .btn-usual-cancel, .pop-show .btn-usual-cancel, .pop-usual .btn-close'
      ) as HTMLElement;
      if (cancelBtn) cancelBtn.click();
    }).catch(() => null);
    await logNormalDelay(300, 0.1);
  }
}
