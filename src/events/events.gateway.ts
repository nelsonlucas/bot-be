import { InjectModel } from '@nestjs/mongoose';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsResponse,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Candle, CandleDocument } from './entities/candles';
import { Model } from 'mongoose';
import { binanceApi } from 'src/apis/binance';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CandlePattern } from './CandlePattern';
import { Logger } from '@nestjs/common';
import { EventsService } from './events.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    @InjectModel(Candle.name)
    private candleModel: Model<CandleDocument>,
    private candlePattern: CandlePattern,
    private eventsService: EventsService,
  ) {}

  // @Cron(CronExpression.EVERY_5_MINUTES)
  async syncMarketBinance() {
    const getAllSymbol = await binanceApi.get(`v3/exchangeInfo`);
    const allSymbol = getAllSymbol.data.symbols.map((item) => item.symbol);
    const interval = '1h';
    for (const symbol of allSymbol || []) {
      const { data: market } = await binanceApi.get(
        `v3/klines?symbol=${symbol}&interval=${interval}&limit=999`,
      );

      const allPromises = market.map((item) =>
        this.candleModel.findOneAndUpdate(
          {
            symbol,
            timeframe: interval,
            openTime: new Date(item[0]),
          },
          {
            timeframe: interval,
            openTime: new Date(item[0]),
            open: item[1],
            high: item[2],
            low: item[3],
            close: item[4],
            volume: item[5],
            closeTime: new Date(item[6]),
            quoteAssetsVolume: item[7],
            numberOfTrades: item[8],
            takerBuyBaseVolume: item[9],
            takerBuyQuoteVolume: item[10],
            takerBuyQuoteAssetVolume: item[7],
            ignore: item[11],
          },
          {
            upsert: true,
            new: true,
          },
        ),
      );

      await Promise.all(allPromises);
    }
  }

  @SubscribeMessage(`getSymbol`)
  async getSymbol(): Promise<WsResponse> {
    const { data } = await binanceApi.get(`v3/exchangeInfo`);
    return {
      event: 'getSymbol',
      data: data.symbols
        .filter(
          (item) =>
            item.status === 'TRADING' &&
            String(item.symbol).substring(
              item.symbol.length - 4,
              item.symbol.length,
            ) === 'USDT',
        )
        .map((item) => item.symbol),
    };
  }

  @SubscribeMessage('marketData')
  async identity(@MessageBody() params: any): Promise<{
    event: string;
    data: (CandleDocument & { color: string })[];
  }> {
    const candles = await this.candleModel
      .find({ symbol: params.symbol })
      .sort({ openTime: 1 })
      .limit(100)
      .lean();

    for (const [index, candle] of candles.entries()) {
      const pp = await this.eventsService.predict({
        indexCurrentCandle: index,
        candle,
        candles,
      });

      const close = candle.close;
      const predictClose = pp.predictClose;
      const diff = close - predictClose;
      const status = predictClose < close ? 'Acertou' : 'Errou';

      this.logger.debug(
        `Preço de Mercado: ${new Intl.NumberFormat('pt-BR', { currency: 'BRL', minimumFractionDigits: 2 }).format(pp.close)} | Preço de Predicao: ${new Intl.NumberFormat('pt-BR', { currency: 'BRL', minimumFractionDigits: 2 }).format(pp.predictClose)} | Diferença: ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(diff)} | Status: ${status}`,
      );
    }

    const marketSerialized = candles.map(async (item, index, array) => {
      //

      // verificar se e insideBar
      let insideBar: Boolean = false;
      if (index !== 0) {
        insideBar = this.candlePattern.insideBar({
          currentCandles: item,
          beforeCandle: array?.[index - 1],
        });
      }

      return {
        x: new Date(item.openTime).toUTCString(),
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        ...(insideBar && {
          color: '#bf2222',
          lineColor: '#000000',
        }),
      };
    });

    return {
      event: 'marketData',
      data: marketSerialized as any,
    };
  }
}
