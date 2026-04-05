import math

def calculate_haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance in kilometers between two points
    on the earth (specified in decimal degrees).
    This handles the earth's curvature!
    """
    R = 6371.0 # Radius of earth in kilometers
    
    # Convert decimal degrees to radians 
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)

    # Haversine formula 
    dlon = lon2_rad - lon1_rad 
    dlat = lat2_rad - lat1_rad 
    a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a)) 
    distance = R * c
    
    return distance
