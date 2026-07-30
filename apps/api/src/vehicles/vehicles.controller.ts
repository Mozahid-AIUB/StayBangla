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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt-access.strategy";
import { VehiclesService, VehicleAvailability } from "./vehicles.service";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";
import { SearchAvailableVehiclesDto } from "./dto/search-available-vehicles.dto";

@ApiTags("vehicles")
@Controller("vehicles")
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @ApiOperation({
    summary:
      "Search for available vehicles across all vendors for a date range",
  })
  @ApiResponse({
    status: 200,
    description:
      "Vehicles with no overlapping booking/block for the given dates.",
  })
  @ApiResponse({
    status: 400,
    description: "startDate is not before endDate, or a date is in the past.",
  })
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

  @ApiOperation({ summary: "Get a vehicle's public detail page" })
  @ApiResponse({ status: 200, description: "Vehicle detail." })
  @ApiResponse({ status: 404, description: "Vehicle not found." })
  @Get(":id")
  async findOne(@Param("id") id: string): Promise<Vehicle> {
    return this.vehiclesService.findByIdOrThrow(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a vehicle listing (vendor only)" })
  @ApiResponse({ status: 201, description: "Vehicle created." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller is not a VENDOR, or is not yet verified.",
  })
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("VENDOR")
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateVehicleDto,
  ): Promise<Vehicle> {
    return this.vehiclesService.create(user.id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a vehicle's price or active status" })
  @ApiResponse({ status: 200, description: "Vehicle updated." })
  @ApiResponse({ status: 401, description: "Missing or invalid access token." })
  @ApiResponse({
    status: 403,
    description: "Caller does not own this vehicle.",
  })
  @ApiResponse({ status: 404, description: "Vehicle not found." })
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
