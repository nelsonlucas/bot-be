import { Controller, Get, Logger, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { EventsService, Signal } from './events.service';
import { InjectModel } from '@nestjs/mongoose';
import { Candle, CandleDocument } from './entities/candles';
import { Model } from 'mongoose';
import { writeFileSync } from 'fs';
import * as daysjs from 'dayjs';
import { unparse } from 'papaparse';
import * as _ from 'lodash';
import { Predict, PredictDocument } from './entities/predict';

@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);
  constructor(
    private readonly eventsService: EventsService,
    @InjectModel(Candle.name)
    private candleModel: Model<CandleDocument>,
    @InjectModel(Predict.name)
    private predictModel: Model<PredictDocument>,
  ) {}

  @Post('predict')
  async predict(@Req() req: Request, @Res() res: Response) {
    let candles = await this.candleModel
      .find({ symbol: req?.body?.symbol })
      .sort({ date: 1 })
      .lean();
    // let candles: any = await this.eventsService.getDataStock({
    //   symbol: req?.query?.symbol.toString(),
    //   period1: req?.query?.startDate.toString(),
    //   period2: req?.query?.endDate.toString(),
    // });

    let body = [];
    for (const [index, candle] of candles.entries()) {

      // realiza a predicao dos precos de fechamento
      const predict: any = await this.eventsService.predict({
        indexCurrentCandle: index,
        candle,
        candles,
      });

      const predictClose = predict?.predictClose ?? 0;
      const operation = predict?.predictOperation;

      body.push({
        ticker: req?.body?.symbol.toString(),
        date:  candle?.date,
        open: candle.open,
        close: candle.close,
        predictClose,
        operation,
      });
    }

    const mean = _.mean(body.map((item) => item.close));
    const std = Math.sqrt(_.mean(body.map((x) => (x.close - mean) ** 2)));

    const zLimit = 2;
    body = body.filter((x) => Math.abs((x.close - mean) / std) <= zLimit);

    // zerar as predicoes daquele ativo e salvar os novos resultado
    await this.predictModel.deleteMany({ ticker: req?.query?.symbol });
    body.map(async(item) =>
      await this.predictModel.findOneAndUpdate(
        {
          ticker: item.ticker,
          date: item?.date,
        },
        {
          open: item.open,
          close: item.close,
          predictClose: item?.predictClose,
          operation: item?.operation,
        },
        {
          upsert: true,
          new: true,
        },
      ),
    );

    
    return res.json({
      success:true,msg: "Predictions saved"
    });
  }

  @Get('executeBackTest')
  async executeBackTest(@Req() req: Request, @Res() res: Response) {

    // buscar os dados de predicoes
    const dataPredict = await this.predictModel.find({ ticker: req?.query?.symbol }).sort({ date: 1 }).lean();


    let currentOperationIA: any = {};
    let currentOperationMarket: any = {};
    const output = [];
    const historic = [];
    for (const [index, op] of dataPredict.entries()) {
      if (!op?.operation) {
        continue;
      }

      /* ANALISE DO LUCRO BASEADO NOS VALORES PREDICIONADOS */
      const currentOperationIAtmp =  currentOperationIA;
      currentOperationIA = await this.eventsService.executeBackTest2({
        lote: Object.keys(currentOperationIA).length > 0 ? currentOperationIA.lote : 100,
        typeOperation: op.operation,
        price:
          Object.keys(currentOperationIA).length > 0 && currentOperationIA?.status === 'CLOSE'
              ? +(+op.open.toFixed(2))
              : +(+op.predictClose.toFixed(2)),
        currentOperation: currentOperationIA,
      });
      /* ------------------------------------------------------------------------------------- */

      /* ANALISE DO LUCRO BASEADO NOS VALORES DE MERCADO */
      currentOperationMarket = await this.eventsService.executeBackTest2({
        lote:
          Object.keys(currentOperationMarket).length > 0
            ? currentOperationMarket.lote
            : 100,
        typeOperation: op.operation,
        price:
          Object.keys(currentOperationMarket).length > 0 && currentOperationMarket?.status === 'CLOSE'
              ? +(+op.open.toFixed(2))
              : +(+op.close.toFixed(2)),
        currentOperation: currentOperationMarket,
      });
      /* ------------------------------------------------------------------------------------- */

      // if(currentOperationIA?.closePrice){
        historic.push({
          date: op.date,
          profit: currentOperationIAtmp.profit,
          isIA:true,
        });
      // }

      output.push({
        LucroMarket: currentOperationMarket?.profit || 0,
        LucroIA: currentOperationIA?.profit || 0,
      });
    }

    const calculated = output.reduce(
      (acc, item) => {
        acc.LucroMarket += item.LucroMarket;
        acc.LucroIA += item.LucroIA;
        return acc;
      },
      { LucroMarket: 0, LucroIA: 0 },
    );

    const bodyOutput = {
      historic,
      calculated,
      output,
      profits: {
        lucroIA: output.flatMap((item) => [item.LucroIA]),
        lucroMarket: output.flatMap((item) => [item.LucroMarket]),
      },
    };

    return res.json(bodyOutput);
  }

  @Post('syncMarket')
  async syncMarket(@Req() req: Request, @Res() res: Response) {
    const candles = await this.eventsService.getDataStock({
      symbol: req?.body?.symbol.toString(),
      period1: req?.body?.startDate.toString(),
      period2: req?.body?.endDate.toString(),
    });

    for (const candle of candles || []) {
      await this.candleModel.findOneAndUpdate(
        {
         symbol: req?.body?.symbol.toString(),
         timeframe: `D`,
         date: candle.date,
        },
        {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
        {
          upsert: true,
          new: true,
        },
      );
    }
    return res.json(candles);
  }

  @Get('getTicker')
  async getTicker(@Req() req: Request, @Res() res: Response) {

    // buscar os codigos que foram feiros as predicoes
     const tickers = await this.predictModel.distinct('ticker').lean();
    return res.json(tickers);
  }


  @Get('processar')
  async processar(@Req() req: Request, @Res() res: Response) {
    await this.eventsService.processar();
return res.json("feito")  }
}
