import { Controller, Get, Logger, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { EventsService, Signal } from './events.service';
import { InjectModel } from '@nestjs/mongoose';
import { Candle, CandleDocument } from './entities/candles';
import { Model } from 'mongoose';
import { writeFileSync } from 'fs';
import * as daysjs from 'dayjs';
import { unparse } from 'papaparse';

@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);
  constructor(
    private readonly eventsService: EventsService,
    @InjectModel(Candle.name)
    private candleModel: Model<CandleDocument>,
  ) {}

  @Get('predict')
  async predict(@Req() req: Request, @Res() res: Response) {
    // let candles = await this.candleModel
    //   .find({ symbol: req?.query?.symbol })
    //   .sort({ openTime: -1 })
    //   .limit(50)
    //   .lean();
    let candles:any = await this.eventsService.getDataStock();

    let body = [];
    for (const [index, candle] of candles.entries()) {
      const predict = await this.eventsService.predict({
        indexCurrentCandle: index,
        candle,
        candles,
      });

      const predictClose = predict.predictClose;
      const predictOpen = predict.predictOpen;
      const operation = predict.predictOperation;

      body.push({
        // date: daysjs(candle.openTime).format('DD/MM/YYYY HH:mm'),
        date: candle?.openTime || candle.date,
        open: candle.open,
        close: candle.close,
        predictOpen,
        predictClose,
        operation,
      });
    }

    // aplicar backtest
    for (const op of body) {

        const signals:Signal[] = [
            {
                price: op.open,
                operation: 'BUY'
            },
            {
                price: op.predictClose,
                operation: 'SELL'
            }
        ];
        const balance = await this.eventsService.executeBackTest({
            initialBalance: 5000,
            signals,
        });
    }
    // body = body.sort((a:any,b:any) => a.date < b.date ? 1 :-1).map((e) => ({...e,date: daysjs(e?.openTime ?? e?.date).format('DD/MM/YYYY HH:mm')}));


    // writeFileSync(`predict.json`, JSON.stringify(body, null, 2));
   
    // const csv = unparse(body);
    // writeFileSync('output.csv', csv);
   
    return res.json();
  }

  @Get('getDataStock')
  async getDataStock(@Req() req: Request, @Res() res: Response) {
    const result = await this.eventsService.getDataStock();
    return res.json();
  }

  @Post('syncMarket')
  async syncMarket(@Req() req: Request, @Res() res: Response) {
    const result = await this.eventsService.syncMarketBinance({
      symbol: req?.body?.symbol,
      timeframe: req?.body?.timeframe,
    });
    return res.json(result);
  }
}
