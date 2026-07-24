import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Vehicle } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { VehiclesService, VehicleAvailability } from "./vehicles.service";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";
import { SearchAvailableVehiclesDto } from "./dto/search-available-vehicles.dto";

@Controller("vehicles")
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get("available")
  async available(
    @Query() query: SearchAvailableVehiclesDto,
  ): Promise<VehicleAvailability[]> {
    return this.vehiclesService.searchAvailable(
      query.startDate,
      query.endDate,
      query.city,
    );
  }

  @Get(":id")
  async findOne(@Param("id") id: string): Promise<Vehicle> {
    return this.vehiclesService.findByIdOrThrow(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehiclesService.create(user.id, dto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: UpdateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehiclesService.update(user.id, id, dto);
  }
}
